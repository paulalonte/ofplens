import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../../test/mockApi';
import { fixturePlan, fixtureWeather, PLAN_IDS } from '../../test/plans';
import { jsonResponse } from '../../test/render';
import { renderApp } from '../../test/renderApp';

/** The saved-plan page's takeoff & landing card, with the conditions now from the latest METAR. */
const ID = PLAN_IDS.kgs;
const PLAN = 'eddb-eddm-c750-kgs';
const base = {
  'GET /api/pilot': () =>
    jsonResponse({ pilot: { simbriefUsername: 'jetpilot', weightUnit: 'kgs' } }),
  [`GET /api/flight-plans/${ID}`]: () =>
    jsonResponse({ id: ID, importedAt: '2026-11-09T21:00:00Z', plan: fixturePlan(PLAN) }),
};

/** "Label" -> the row's value, planned and now, as text. */
async function rows(name: 'Takeoff runway' | 'Landing runway') {
  const section = await screen.findByRole('region', { name });
  return Object.fromEntries(
    within(section)
      .getAllByRole('term')
      .map((dt) => [dt.textContent ?? '', dt.nextElementSibling?.textContent ?? '']),
  );
}

describe('Saved plan: takeoff & landing with the conditions now', () => {
  it('shows the live METAR wind, temperature and QNH under the planned values', async () => {
    mockApi({
      ...base,
      [`GET /api/flight-plans/${ID}/weather`]: () => jsonResponse(fixtureWeather(PLAN)),
    });
    await renderApp(`/history/${ID}`);

    // EDDB 06L (true 069): planned 095/05 from the right; 340/03 now, almost straight across from the left.
    expect(await rows('Takeoff runway')).toMatchObject({
      Wind: '095° / 5 ktNow 340° / 3 kt',
      Headwind: '4 ktNow 0 kt headwind',
      Crosswind: '3 kt from the rightNow 3 kt from the left',
    });
    const takeoff = screen.getByRole('region', { name: 'Takeoff runway' });
    expect(takeoff).toHaveTextContent(/METAR \d\d:\d\dZ/);
    // EDDB 100850Z ... 03/01 Q1013: the pressure has dropped since dispatch.
    expect(await rows('Takeoff runway')).toMatchObject({
      Temperature: '3°CNow 3°C',
      QNH: '1021 hPa · 30.15 inHgNow 1013 hPa · 29.91 inHg',
    });

    // EDDM 08R (true 083): 270/03 now is a tailwind where a headwind was planned.
    expect(await rows('Landing runway')).toMatchObject({
      Wind: '087° / 6 ktNow 270° / 3 kt',
      Headwind: '6 ktNow 3 kt tailwind',
      Crosswind: '1 kt from the rightNow None',
      QNH: expect.stringMatching(/Now 1012 hPa · 29\.88 inHg$/),
    });
    const tailwind = within(screen.getByRole('region', { name: 'Landing runway' })).getByText(
      'Now 3 kt tailwind',
    );
    expect(tailwind).toHaveClass('text-amber-700');
    expect(screen.getByRole('region', { name: 'Takeoff & landing' })).toHaveTextContent(
      'now from the latest METAR',
    );
  });

  it('says when there is no live METAR yet and keeps the planned values', async () => {
    mockApi({
      ...base,
      [`GET /api/flight-plans/${ID}/weather`]: () =>
        jsonResponse(
          fixtureWeather(PLAN, { live: false, liveCheckedAt: new Date().toISOString() }),
        ),
    });
    await renderApp(`/history/${ID}`);

    expect(await rows('Takeoff runway')).toMatchObject({
      Wind: '095° / 5 kt',
      Headwind: '4 kt',
    });
    expect(screen.getByRole('region', { name: 'Takeoff runway' })).toHaveTextContent(
      'No live METAR',
    );
  });

  it('shows planning data only on development sample pages', async () => {
    mockApi({ 'GET /api/pilot': base['GET /api/pilot'] });
    await renderApp(`/sample/${PLAN}`);

    const takeoff = await screen.findByRole('region', { name: 'Takeoff runway' });
    expect(takeoff).not.toHaveTextContent('Now');
    expect(takeoff).not.toHaveTextContent('METAR');
  });
});
