import { formatZulu } from '@ofplens/ofp';
import type { FlightPlanHazardsResponse, RouteHazardView } from '@ofplens/weather';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi } from '../../test/mockApi';
import { fixturePlan, PLAN_IDS } from '../../test/plans';
import { jsonResponse } from '../../test/render';
import { renderApp } from '../../test/renderApp';

/** The saved-plan page's hazards along the route, and their marks in the navlog. */
const ID = PLAN_IDS.kgs;
const PLAN = 'eddb-eddm-c750-kgs';
const base = {
  'GET /api/pilot': () =>
    jsonResponse({ pilot: { simbriefUsername: 'jetpilot', weightUnit: 'kgs' } }),
  [`GET /api/flight-plans/${ID}`]: () =>
    jsonResponse({ id: ID, importedAt: '2026-11-09T21:00:00Z', plan: fixturePlan(PLAN) }),
};
const HAZARDS = `/api/flight-plans/${ID}/hazards`;
const hoursFromNow = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const refreshes = (calls: { method: string; path: string }[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === `${HAZARDS}/refresh`);

// Over PIKIB: from BEBKU (seq 6) to MAREM (seq 8).
const thunderstorm: RouteHazardView = {
  id: 'isigmet:EDUU:A1:1794225600',
  source: 'isigmet',
  hazard: 'thunderstorm',
  code: 'TS',
  severity: null,
  detail: 'EMBD',
  validFrom: hoursFromNow(-1),
  validTo: hoursFromNow(2),
  baseFt: null,
  topFt: 38000,
  polygons: [],
  fir: 'EDUU',
  firName: 'EDUU RHEIN UIR',
  rawText: 'EDUU SIGMET A1 VALID 091200/091600 EDZZ- EDUU RHEIN UIR EMBD TS FCST TOP FL380',
  segments: [{ fromSeq: 6, toSeq: 8, fromIdent: 'BEBKU', toIdent: 'MAREM' }],
};
// Over the descent, twice: TOD (12) to NETES (13), and TUSTO (15) to LANDU (16).
const turbulence: RouteHazardView = {
  ...thunderstorm,
  id: 'gairmet:TANGO:1C:TURB-LO:x',
  source: 'gairmet',
  hazard: 'turbulence',
  code: 'TURB-LO',
  severity: 'moderate',
  detail: null,
  validFrom: hoursFromNow(1),
  baseFt: 18000,
  topFt: 30000,
  fir: null,
  firName: null,
  rawText: null,
  segments: [
    { fromSeq: 12, toSeq: 13, fromIdent: 'TOD', toIdent: 'NETES' },
    { fromSeq: 15, toSeq: 16, fromIdent: 'TUSTO', toIdent: 'LANDU' },
  ],
};

const response = (overrides: Partial<FlightPlanHazardsResponse> = {}) => ({
  checkedAt: new Date().toISOString(),
  takeoffAt: hoursFromNow(1),
  unavailable: [],
  advisoriesChecked: 160,
  hazards: [thunderstorm, turbulence],
  ...overrides,
});

const card = () => screen.findByRole('region', { name: 'Hazards along the route' });
const navlogRow = (ident: string) =>
  screen.getByRole('rowheader', { name: new RegExp(`^${ident}\\b`) });

describe('Saved plan: hazards along the route', () => {
  it('lists each hazard with where, levels, validity and its bulletin', async () => {
    const api = mockApi({ ...base, [`GET ${HAZARDS}`]: () => jsonResponse(response()) });
    await renderApp(`/history/${ID}`);

    const items = within(await card()).getAllByRole('listitem');
    expect(items).toHaveLength(2);

    const ts = within(items[0]!);
    expect(items[0]).toHaveAccessibleName('Thunderstorms');
    expect(ts.getByText('embedded')).toBeInTheDocument();
    expect(ts.getByText('SIGMET · EDUU RHEIN UIR')).toBeInTheDocument();
    expect(ts.getByText('BEBKU → MAREM')).toBeInTheDocument();
    expect(ts.getByText('Up to FL380')).toBeInTheDocument();
    expect(ts.getByText(`until ${formatZulu(thunderstorm.validTo)}`)).toBeInTheDocument();
    expect(ts.getByText('Bulletin')).toBeInTheDocument();
    expect(items[0]).toHaveTextContent('EMBD TS FCST TOP FL380');

    const turb = within(items[1]!);
    expect(items[1]).toHaveAccessibleName('Turbulence');
    expect(turb.getByText('Moderate')).toBeInTheDocument();
    expect(turb.getByText('G-AIRMET')).toBeInTheDocument();
    expect(turb.getByText('TOD → NETES, TUSTO → LANDU')).toBeInTheDocument();
    expect(turb.getByText('FL180–FL300')).toBeInTheDocument();
    // Starts after the check: both ends shown.
    expect(
      turb.getByText(`${formatZulu(turbulence.validFrom)} to ${formatZulu(turbulence.validTo)}`),
    ).toBeInTheDocument();
    expect(turb.queryByText('Bulletin')).not.toBeInTheDocument();

    // Checked just now: no automatic check.
    expect(await card()).toHaveTextContent(/Checked \d\d:\d\dZ/);
    expect(refreshes(api.calls)).toEqual([]);
  });

  it('marks the navlog fixes inside each hazard', async () => {
    mockApi({ ...base, [`GET ${HAZARDS}`]: () => jsonResponse(response()) });
    await renderApp(`/history/${ID}`);
    await card();

    for (const ident of ['BEBKU', 'PIKIB', 'MAREM']) {
      expect(navlogRow(ident)).toHaveTextContent('⚠ TS');
    }
    for (const ident of ['TOD', 'NETES', 'TUSTO', 'LANDU']) {
      expect(navlogRow(ident)).toHaveTextContent('⚠ TURB-LO');
    }
    for (const ident of ['LUROS', 'VESUB', 'KUFAZ', 'EDDM']) {
      expect(navlogRow(ident)).not.toHaveTextContent('⚠');
    }
  });

  it('says when none is on the route, with how many were checked', async () => {
    mockApi({ ...base, [`GET ${HAZARDS}`]: () => jsonResponse(response({ hazards: [] })) });
    await renderApp(`/history/${ID}`);

    const c = await card();
    expect(c).toHaveTextContent(/None on your route\. 160 advisories checked at \d\d:\d\dZ\./);
    expect(within(c).queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByText(/^⚠/)).not.toBeInTheDocument();
  });

  it('says which feed could not be read', async () => {
    mockApi({
      ...base,
      [`GET ${HAZARDS}`]: () =>
        jsonResponse(response({ hazards: [], unavailable: ['gairmet'], advisoriesChecked: 129 })),
    });
    await renderApp(`/history/${ID}`);

    expect(await card()).toHaveTextContent(
      'US G-AIRMETs could not be read at this check, so hazards from it may be missing.',
    );
  });

  it('checks the route on open when it was never checked', async () => {
    const api = mockApi({
      ...base,
      [`GET ${HAZARDS}`]: () =>
        jsonResponse(
          response({ checkedAt: null, takeoffAt: null, advisoriesChecked: 0, hazards: [] }),
        ),
      [`POST ${HAZARDS}/refresh`]: () => jsonResponse(response()),
    });
    await renderApp(`/history/${ID}`);

    expect(await screen.findByText('BEBKU → MAREM')).toBeInTheDocument();
    expect(refreshes(api.calls)).toHaveLength(1);
    expect(navlogRow('PIKIB')).toHaveTextContent('⚠ TS');
  });

  it('keeps the last check when the feeds are unavailable', async () => {
    mockApi({
      ...base,
      [`GET ${HAZARDS}`]: () =>
        jsonResponse(response({ checkedAt: new Date(Date.now() - 3_600_000).toISOString() })),
      [`POST ${HAZARDS}/refresh`]: () =>
        apiError(502, 'HAZARDS_UNAVAILABLE', 'Hazard advisories are unavailable right now'),
    });
    await renderApp(`/history/${ID}`);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Hazard advisories are unavailable right now. Showing the last check.',
    );
    expect(screen.getByText('BEBKU → MAREM')).toBeInTheDocument();
  });

  it('checks again with the weather card’s Refresh', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...base,
      [`GET ${HAZARDS}`]: () => jsonResponse(response({ hazards: [] })),
      [`POST /api/flight-plans/${ID}/weather/refresh`]: () =>
        jsonResponse({ stations: [], liveCheckedAt: new Date().toISOString() }),
      [`POST ${HAZARDS}/refresh`]: () => jsonResponse(response()),
    });
    await renderApp(`/history/${ID}`);

    await user.click(await screen.findByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(refreshes(api.calls)).toHaveLength(1));
    expect(await screen.findByText('BEBKU → MAREM')).toBeInTheDocument();
  });
});
