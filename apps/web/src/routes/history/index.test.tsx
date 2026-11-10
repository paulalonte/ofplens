import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../../test/mockApi';
import { fixtureListItem, PLAN_IDS } from '../../test/plans';
import { jsonResponse } from '../../test/render';
import { renderApp } from '../../test/renderApp';

const pilot = () => jsonResponse({ pilot: { simbriefUsername: 'jetpilot', weightUnit: 'kgs' } });

describe('History page', () => {
  it('invites loading a first plan when there are none', async () => {
    mockApi({
      'GET /api/pilot': pilot,
      'GET /api/flight-plans': () => jsonResponse({ items: [], nextCursor: null }),
    });
    await renderApp('/history');

    expect(await screen.findByText(/No saved plans yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Load your latest SimBrief plan' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('lists plans newest first with date, callsign, route, aircraft and block time', async () => {
    mockApi({
      'GET /api/pilot': pilot,
      'GET /api/flight-plans': () =>
        jsonResponse({
          items: [
            fixtureListItem('ksfo-kjfk-b739-lbs', PLAN_IDS.lbs),
            fixtureListItem('eddf-lepa-a339-noalt', PLAN_IDS.noalt),
          ],
          nextCursor: null,
        }),
    });
    await renderApp('/history');

    const rows = await screen.findAllByRole('link', { name: /→/ });
    expect(rows.map((r) => r.getAttribute('href'))).toEqual([
      `/history/${PLAN_IDS.lbs}`,
      `/history/${PLAN_IDS.noalt}`,
    ]);
    expect(rows[0]).toHaveTextContent(/10 NOV 2026 01:00Z\s*UAL1234\s*KSFO → KJFKALT KEWR\s*B739/);
    expect(screen.getByLabelText('Block time 05:18')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('EDDF → LEPA');
    expect(rows[1]).not.toHaveTextContent('ALT');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('loads the next page with the cursor from the first', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /api/pilot': pilot,
      'GET /api/flight-plans': ({ url }) =>
        url.searchParams.get('cursor') === 'page-2'
          ? jsonResponse({
              items: [fixtureListItem('eddb-eddm-c750-kgs', PLAN_IDS.kgs)],
              nextCursor: null,
            })
          : jsonResponse({
              items: [fixtureListItem('ksfo-kjfk-b739-lbs', PLAN_IDS.lbs)],
              nextCursor: 'page-2',
            }),
    });
    await renderApp('/history');

    await user.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByRole('link', { name: /N70P/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /UAL1234/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(api.calls.map((c) => c.path).filter((p) => p.startsWith('/api/flight-plans'))).toEqual([
      '/api/flight-plans?limit=20',
      '/api/flight-plans?limit=20&cursor=page-2',
    ]);
  });
});
