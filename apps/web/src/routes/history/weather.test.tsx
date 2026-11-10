import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi } from '../../test/mockApi';
import { fixturePlan, fixtureWeather, PLAN_IDS } from '../../test/plans';
import { jsonResponse } from '../../test/render';
import { renderApp } from '../../test/renderApp';

/** The saved-plan page's weather: at dispatch (OFP) vs now (aviationweather.gov). */
const ID = PLAN_IDS.kgs;
const PLAN = 'eddb-eddm-c750-kgs';
const base = {
  'GET /api/pilot': () =>
    jsonResponse({ pilot: { simbriefUsername: 'jetpilot', weightUnit: 'kgs' } }),
  [`GET /api/flight-plans/${ID}`]: () =>
    jsonResponse({ id: ID, importedAt: '2026-11-09T21:00:00Z', plan: fixturePlan(PLAN) }),
};
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const posts = (calls: { method: string; path: string }[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === `/api/flight-plans/${ID}/weather/refresh`);

describe('Saved plan: weather at dispatch vs now', () => {
  it('shows both sides per airport with flight categories and flags what changed', async () => {
    const api = mockApi({
      ...base,
      [`GET /api/flight-plans/${ID}/weather`]: () =>
        jsonResponse(fixtureWeather(PLAN, { liveCheckedAt: minutesAgo(2) })),
    });
    await renderApp(`/history/${ID}`);

    const departure = await screen.findByRole('region', { name: 'Departure weather' });
    // EDDB: BKN009 at dispatch → IFR; BKN004 now → LIFR.
    expect(departure).toHaveTextContent('Changed since dispatch: IFR → LIFR');
    expect(
      within(departure)
        .getAllByText(/^(IFR|LIFR)$/)
        .map((b) => b.textContent),
    ).toEqual(['IFR', 'LIFR']);
    expect(departure).toHaveTextContent('EDDB 091320Z AUTO 10005KT 9999 BKN009');
    expect(departure).toHaveTextContent('METAR EDDB 100850Z AUTO 34003KT');
    expect(within(departure).getByText('TAF updated since dispatch')).toBeInTheDocument();
    expect(within(departure).getByTitle('Ceiling 900 ft · visibility 6.21+ SM')).toHaveTextContent(
      'IFR',
    );

    // EDDM: IFR then and now → no flag.
    const destination = screen.getByRole('region', { name: 'Destination weather' });
    expect(destination).not.toHaveTextContent('Changed since dispatch');

    // EDDF: OVC014 (MVFR) → FEW011 (VFR).
    expect(screen.getByRole('region', { name: 'Alternate weather' })).toHaveTextContent(
      'Changed since dispatch: MVFR → VFR',
    );

    // Checked two minutes ago: no automatic refresh.
    expect(screen.getByText(/^Live as of \d\d:\d\dZ$/)).toBeInTheDocument();
    expect(posts(api.calls)).toEqual([]);
  });

  it('fetches live weather automatically when there is none yet', async () => {
    const api = mockApi({
      ...base,
      [`GET /api/flight-plans/${ID}/weather`]: () =>
        jsonResponse(fixtureWeather(PLAN, { live: false })),
      [`POST /api/flight-plans/${ID}/weather/refresh`]: () => jsonResponse(fixtureWeather(PLAN)),
    });
    await renderApp(`/history/${ID}`);

    expect(
      await screen.findByText('Changed since dispatch: IFR → LIFR', {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(posts(api.calls)).toHaveLength(1);
  });

  it('refreshes automatically when live weather is more than 10 minutes old', async () => {
    const api = mockApi({
      ...base,
      [`GET /api/flight-plans/${ID}/weather`]: () =>
        jsonResponse(fixtureWeather(PLAN, { liveCheckedAt: minutesAgo(11) })),
      [`POST /api/flight-plans/${ID}/weather/refresh`]: () => jsonResponse(fixtureWeather(PLAN)),
    });
    await renderApp(`/history/${ID}`);

    await waitFor(() => expect(posts(api.calls)).toHaveLength(1));
  });

  it('refreshes on request', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...base,
      [`GET /api/flight-plans/${ID}/weather`]: () =>
        jsonResponse(fixtureWeather(PLAN, { liveCheckedAt: minutesAgo(3) })),
      [`POST /api/flight-plans/${ID}/weather/refresh`]: () => jsonResponse(fixtureWeather(PLAN)),
    });
    await renderApp(`/history/${ID}`);

    await user.click(await screen.findByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(posts(api.calls)).toHaveLength(1));
    expect(await screen.findByText(/^Live as of /)).toBeInTheDocument();
  });

  it('keeps showing dispatch weather when live weather is unavailable', async () => {
    mockApi({
      ...base,
      [`GET /api/flight-plans/${ID}/weather`]: () =>
        jsonResponse(fixtureWeather(PLAN, { live: false })),
      [`POST /api/flight-plans/${ID}/weather/refresh`]: () =>
        apiError(502, 'WEATHER_UNAVAILABLE', 'Live weather is unavailable right now'),
    });
    await renderApp(`/history/${ID}`);

    expect(
      await screen.findByText(
        'Live weather is unavailable right now. Showing what was stored last.',
      ),
    ).toBeInTheDocument();
    const departure = screen.getByRole('region', { name: 'Departure weather' });
    expect(departure).toHaveTextContent('EDDB 091320Z');
    expect(departure).toHaveTextContent('No live report yet');
  });

  it('leaves the OFP-only weather card on development sample pages', async () => {
    mockApi({ 'GET /api/pilot': base['GET /api/pilot'] });
    await renderApp('/sample/eddb-eddm-c750-kgs');

    expect(await screen.findByRole('region', { name: 'Weather at dispatch' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });
});
