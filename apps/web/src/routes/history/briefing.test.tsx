import { reportId, type Briefing, type StoredBriefing } from '@ofplens/agent/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi } from '../../test/mockApi';
import { fixturePlan, fixtureWeather, PLAN_IDS } from '../../test/plans';
import { jsonResponse } from '../../test/render';
import { renderApp } from '../../test/renderApp';

/** The saved-plan page's AI briefing card (OFP-27), against a scripted event stream. */
const ID = PLAN_IDS.kgs;
const PLAN = 'eddb-eddm-c750-kgs';
const WEATHER = fixtureWeather(PLAN);
const POST = `POST /api/flight-plans/${ID}/briefings`;
const LATEST = `GET /api/flight-plans/${ID}/briefings/latest`;

/** The live METAR the page shows for an airport, and the report id the agent would cite. */
function liveMetar(icao: string) {
  const metar = WEATHER.stations.find((s) => s.icao === icao)?.live.metar;
  if (!metar) throw new Error(`no live METAR for ${icao} in the fixture`);
  return { raw: metar.raw, id: reportId('live', 'metar', icao, metar.observedAt) };
}

const BRIEFING: Briefing = {
  headline: 'Low cloud at Berlin, improving towards Munich',
  overallRisk: 'moderate',
  departure: {
    icao: 'EDDB',
    flightCategory: 'LIFR',
    summary: 'Overcast 400 ft, light wind',
    changedSinceDispatch: true,
    sourceReportId: liveMetar('EDDB').id,
  },
  destination: {
    icao: 'EDDM',
    flightCategory: 'IFR',
    summary: 'Broken 800 ft, visibility good',
    changedSinceDispatch: false,
    sourceReportId: liveMetar('EDDM').id,
  },
  alternate: null,
  enrouteHazards: [],
  pilotNotes: ['Brief the departure for low ceilings', 'Expect an ILS at Munich'],
};

function stored(overrides: Partial<StoredBriefing> = {}): StoredBriefing {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    flightPlanId: ID,
    status: 'done',
    model: 'claude-haiku-5-5',
    promptVersion: 'briefing-v1',
    briefing: BRIEFING,
    error: null,
    inputTokens: 1000,
    outputTokens: 300,
    costUsd: 0.00025,
    latencyMs: 4200,
    toolCalls: [],
    createdAt: '2026-11-10T09:00:00Z',
    finishedAt: '2026-11-10T09:00:04Z',
    ...overrides,
  };
}

/** A text/event-stream response the test writes to, one event at a time. */
function eventStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
  const encoder = new TextEncoder();
  return {
    response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    send(event: string, data: unknown) {
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    },
    close: () => controller.close(),
  };
}

const base = {
  'GET /api/pilot': () =>
    jsonResponse({ pilot: { simbriefUsername: 'jetpilot', weightUnit: 'kgs' } }),
  [`GET /api/flight-plans/${ID}`]: () =>
    jsonResponse({ id: ID, importedAt: '2026-11-09T21:00:00Z', plan: fixturePlan(PLAN) }),
  [`GET /api/flight-plans/${ID}/weather`]: () => jsonResponse(WEATHER),
};

const card = () => screen.findByRole('region', { name: 'AI weather briefing' });
const posts = (calls: { method: string; path: string }[]) =>
  calls.filter((c) => `${c.method} ${c.path}` === POST);

describe('Saved plan: AI briefing', () => {
  it('waits for a click: nothing is generated when the page opens', async () => {
    const api = mockApi(base);
    await renderApp(`/history/${ID}`);

    const region = await card();
    expect(within(region).getByRole('button', { name: 'Generate briefing' })).toBeEnabled();
    expect(region).toHaveTextContent('It runs only when you click');
    expect(region).toHaveTextContent('AI-generated · for flight simulation only');
    expect(posts(api.calls)).toEqual([]);
  });

  it('shows live progress, then the briefing with its cited reports', async () => {
    const user = userEvent.setup();
    const stream = eventStream();
    const api = mockApi({ ...base, [POST]: () => stream.response });
    await renderApp(`/history/${ID}`);
    const region = await card();

    await user.click(within(region).getByRole('button', { name: 'Generate briefing' }));
    expect(within(region).getByRole('button', { name: 'Generating…' })).toBeDisabled();
    const progress = within(region).getByRole('status', { name: 'Briefing progress' });
    expect(progress).toHaveTextContent('Starting…');

    stream.send('started', { id: stored().id });
    stream.send('tool', { name: 'get_flight_plan', ok: true });
    expect(await within(progress).findByText('✓ Read the flight plan')).toBeInTheDocument();
    stream.send('tool', { name: 'get_weather', ok: false });
    expect(
      await within(progress).findByText('! Checked live weather (unavailable)'),
    ).toBeInTheDocument();
    expect(progress).toHaveTextContent('Working on the briefing…');

    stream.send('done', stored());
    stream.close();

    expect(await within(region).findByText(BRIEFING.headline)).toBeInTheDocument();
    expect(region).toHaveTextContent('Risk: moderate');

    const departure = within(region).getByRole('region', { name: 'Departure briefing' });
    expect(departure).toHaveTextContent('EDDB');
    expect(within(departure).getByText('LIFR')).toBeInTheDocument();
    expect(departure).toHaveTextContent('Overcast 400 ft, light wind');
    expect(departure).toHaveTextContent('Changed since dispatch');
    expect(departure).toHaveTextContent(/Based on the live METAR of \d\d [A-Z]{3} \d\d:\d\dZ/);
    expect(departure).toHaveTextContent(liveMetar('EDDB').raw);

    const destination = within(region).getByRole('region', { name: 'Destination briefing' });
    expect(destination).not.toHaveTextContent('Changed since dispatch');
    expect(within(region).queryByRole('region', { name: 'Alternate briefing' })).toBeNull();

    const notes = within(region).getByRole('region', { name: 'Pilot notes' });
    expect(
      within(notes)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(BRIEFING.pilotNotes);
    expect(region).toHaveTextContent(
      'AI-generated · for flight simulation only · claude-haiku-5-5 · 10 NOV 09:00Z',
    );
    expect(within(region).getByRole('button', { name: 'Generate again' })).toBeEnabled();
    expect(posts(api.calls)).toHaveLength(1);
  });

  it('shows why a briefing failed and lets the pilot try again', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const api = mockApi({
      ...base,
      [POST]: () => {
        attempt += 1;
        const stream = eventStream();
        stream.send('started', { id: stored().id });
        stream.send(
          attempt === 1 ? 'failed' : 'done',
          attempt === 1
            ? stored({
                status: 'failed',
                briefing: null,
                error: 'The briefing cited a report that does not exist.',
              })
            : stored(),
        );
        stream.close();
        return stream.response;
      },
    });
    await renderApp(`/history/${ID}`);
    const region = await card();

    await user.click(within(region).getByRole('button', { name: 'Generate briefing' }));

    const alert = await within(region).findByRole('alert');
    expect(alert).toHaveTextContent('The briefing could not be completed.');
    expect(alert).toHaveTextContent('The briefing cited a report that does not exist.');

    await user.click(within(region).getByRole('button', { name: 'Try again' }));
    expect(await within(region).findByText(BRIEFING.headline)).toBeInTheDocument();
    expect(within(region).queryByRole('alert')).toBeNull();
    expect(posts(api.calls)).toHaveLength(2);
  });

  it('explains the daily limit and keeps the stored briefing', async () => {
    const user = userEvent.setup();
    mockApi({
      ...base,
      [LATEST]: () => jsonResponse({ briefing: stored() }),
      [POST]: () =>
        apiError(
          429,
          'BRIEFING_DAILY_LIMIT',
          'The limit of 20 briefings per day has been reached. Try again later.',
        ),
    });
    await renderApp(`/history/${ID}`);
    const region = await card();

    await user.click(within(region).getByRole('button', { name: 'Generate again' }));

    const alert = await within(region).findByRole('alert');
    expect(alert).toHaveTextContent('Daily briefing limit reached');
    expect(alert).toHaveTextContent('The limit of 20 briefings per day has been reached.');
    expect(within(region).getByText(BRIEFING.headline)).toBeInTheDocument();
  });

  it('says when briefings are not set up on the server', async () => {
    const user = userEvent.setup();
    mockApi({
      ...base,
      [POST]: () =>
        apiError(503, 'BRIEFINGS_NOT_CONFIGURED', 'AI briefings are not set up on this server.'),
    });
    await renderApp(`/history/${ID}`);
    const region = await card();

    await user.click(within(region).getByRole('button', { name: 'Generate briefing' }));

    expect(await within(region).findByRole('alert')).toHaveTextContent(
      'AI briefings are not set up',
    );
  });

  it('loads the latest stored briefing with the page, without generating a new one', async () => {
    const api = mockApi({ ...base, [LATEST]: () => jsonResponse({ briefing: stored() }) });
    await renderApp(`/history/${ID}`);
    const region = await card();

    expect(within(region).getByText(BRIEFING.headline)).toBeInTheDocument();
    expect(region).toHaveTextContent('claude-haiku-5-5 · 10 NOV 09:00Z');
    expect(posts(api.calls)).toEqual([]);
  });

  it('shows a briefing that is still running elsewhere and can check on it', async () => {
    const user = userEvent.setup();
    let latest: StoredBriefing = stored({ status: 'pending', briefing: null, finishedAt: null });
    const api = mockApi({ ...base, [LATEST]: () => jsonResponse({ briefing: latest }) });
    await renderApp(`/history/${ID}`);
    const region = await card();

    expect(region).toHaveTextContent('A briefing started at 09:00Z is still being written.');
    expect(within(region).getByRole('button', { name: 'Generate again' })).toBeDisabled();

    latest = stored();
    await user.click(within(region).getByRole('button', { name: 'Check again' }));
    expect(await within(region).findByText(BRIEFING.headline)).toBeInTheDocument();
    await waitFor(() =>
      expect(api.calls.filter((c) => c.path.endsWith('/briefings/latest'))).toHaveLength(2),
    );
  });

  it('is not offered on development sample pages', async () => {
    mockApi({ 'GET /api/pilot': base['GET /api/pilot'] });
    await renderApp('/sample/eddb-eddm-c750-kgs');

    expect(await screen.findByRole('region', { name: 'Weather at dispatch' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'AI weather briefing' })).toBeNull();
  });
});
