import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi } from '../test/mockApi';
import { fixtureListItem, fixturePlan, PLAN_IDS } from '../test/plans';
import { jsonResponse } from '../test/render';
import { renderApp } from '../test/renderApp';

const pilot =
  (weightUnit: 'kgs' | 'lbs' = 'kgs') =>
  () =>
    jsonResponse({ pilot: { simbriefUsername: 'jetpilot', weightUnit } });
const emptyHistory = () => jsonResponse({ items: [], nextCursor: null });

describe('Home', () => {
  it('asks for a username first and keeps the button disabled', async () => {
    const api = mockApi({
      'GET /api/pilot': () => jsonResponse({ pilot: null }),
      'GET /api/flight-plans': emptyHistory,
    });
    await renderApp('/');

    expect(await screen.findByText('Set your SimBrief username first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load latest plan' })).toBeDisabled();
    expect(api.calls.some((c) => c.path.startsWith('/api/flight-plans/import'))).toBe(false);
  });

  it('shows the most recent saved plans, linking to them', async () => {
    mockApi({
      'GET /api/pilot': pilot(),
      'GET /api/flight-plans': () =>
        jsonResponse({
          items: [
            fixtureListItem('ksfo-kjfk-b739-lbs', PLAN_IDS.lbs),
            fixtureListItem('eddb-eddm-c750-kgs', PLAN_IDS.kgs),
          ],
          nextCursor: null,
        }),
    });
    await renderApp('/');

    const recent = await screen.findByRole('region', { name: 'Recent plans' });
    const link = await within(recent).findByRole('link', { name: /UAL1234/ });
    expect(link).toHaveAttribute('href', `/plans/${PLAN_IDS.lbs}`);
    expect(link).toHaveTextContent('10 NOV 2026 01:00Z');
    expect(link).toHaveTextContent('KSFO → KJFK');
    expect(within(recent).getByRole('link', { name: 'All plans' })).toHaveAttribute(
      'href',
      '/history',
    );
  });

  it('saves the latest plan and opens its briefing in one click', async () => {
    const user = userEvent.setup();
    const plan = fixturePlan('ksfo-kjfk-b739-lbs');
    const api = mockApi({
      'GET /api/pilot': pilot(),
      'GET /api/flight-plans': emptyHistory,
      'POST /api/flight-plans/import': () =>
        jsonResponse({ id: PLAN_IDS.lbs, created: true, plan }, 201),
      [`GET /api/flight-plans/${PLAN_IDS.lbs}`]: () =>
        jsonResponse({ id: PLAN_IDS.lbs, importedAt: '2026-11-09T21:00:00Z', plan }),
    });
    const { router } = await renderApp('/');

    await user.click(await screen.findByRole('button', { name: 'Load latest plan' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'UAL1234' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/plans/${PLAN_IDS.lbs}`);
    expect(screen.getByText('Saved to your history.')).toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      '/api/flight-plans/import',
    ]);
  });

  it('says so when the latest plan was already saved', async () => {
    const user = userEvent.setup();
    const plan = fixturePlan('eddb-eddm-c750-kgs');
    mockApi({
      'GET /api/pilot': pilot(),
      'GET /api/flight-plans': emptyHistory,
      'POST /api/flight-plans/import': () =>
        jsonResponse({ id: PLAN_IDS.kgs, created: false, plan }),
      [`GET /api/flight-plans/${PLAN_IDS.kgs}`]: () =>
        jsonResponse({ id: PLAN_IDS.kgs, importedAt: '2026-11-09T21:00:00Z', plan }),
    });
    await renderApp('/');

    await user.click(await screen.findByRole('button', { name: 'Load latest plan' }));

    expect(
      await screen.findByText('Already in your history. SimBrief has no newer plan for you yet.'),
    ).toBeInTheDocument();
  });

  it('explains an unknown SimBrief user and points to Settings', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/pilot': pilot(),
      'GET /api/flight-plans': emptyHistory,
      'POST /api/flight-plans/import': () =>
        apiError(
          404,
          'SIMBRIEF_NOT_FOUND',
          'SimBrief has no flight plan for "jetpilot" (Unknown UserID).',
        ),
    });
    await renderApp('/');

    await user.click(await screen.findByRole('button', { name: 'Load latest plan' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load your latest plan');
    expect(alert).toHaveTextContent('Unknown UserID');
    expect(
      within(alert).getByRole('link', { name: 'Check your username in Settings' }),
    ).toBeInTheDocument();
  });

  it('suggests trying again when SimBrief is unavailable', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/pilot': pilot(),
      'GET /api/flight-plans': emptyHistory,
      'POST /api/flight-plans/import': () =>
        apiError(502, 'SIMBRIEF_UNAVAILABLE', 'SimBrief did not answer within 10 s'),
    });
    await renderApp('/');

    await user.click(await screen.findByRole('button', { name: 'Load latest plan' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This is usually temporary.');
  });
});
