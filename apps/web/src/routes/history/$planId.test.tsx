import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi } from '../../test/mockApi';
import { fixturePlan, PLAN_IDS } from '../../test/plans';
import { jsonResponse } from '../../test/render';
import { renderApp } from '../../test/renderApp';

const pilot =
  (weightUnit: 'kgs' | 'lbs' = 'kgs') =>
  () =>
    jsonResponse({ pilot: { simbriefUsername: 'jetpilot', weightUnit } });

function storedPlan(fixture: string, id: string) {
  return () => jsonResponse({ id, importedAt: '2026-11-09T21:00:00Z', plan: fixturePlan(fixture) });
}

describe('Saved plan page', () => {
  it('shows the stored plan’s briefing in the preferred unit', async () => {
    mockApi({
      'GET /api/pilot': pilot('lbs'),
      [`GET /api/flight-plans/${PLAN_IDS.kgs}`]: storedPlan('eddb-eddm-c750-kgs', PLAN_IDS.kgs),
    });
    await renderApp(`/history/${PLAN_IDS.kgs}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'N70P' })).toBeInTheDocument();
    expect(await screen.findByText('5,362 lb')).toBeInTheDocument(); // block fuel 2,432 kg
    expect(screen.getByRole('region', { name: 'Navigation log' })).toBeInTheDocument();
    // Only shown right after "Load latest plan".
    expect(screen.queryByText(/your history/)).not.toBeInTheDocument();
  });

  it('explains a plan that no longer exists', async () => {
    mockApi({
      'GET /api/pilot': pilot(),
      [`GET /api/flight-plans/${PLAN_IDS.kgs}`]: () =>
        apiError(
          404,
          'FLIGHT_PLAN_NOT_FOUND',
          'That flight plan does not exist (it may have been deleted).',
        ),
    });
    await renderApp(`/history/${PLAN_IDS.kgs}`);

    expect(await screen.findByRole('heading', { name: 'Plan not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to history' })).toHaveAttribute(
      'href',
      '/history',
    );
  });

  it('deletes after confirmation and returns to the history', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /api/pilot': pilot(),
      'GET /api/flight-plans': () => jsonResponse({ items: [], nextCursor: null }),
      [`GET /api/flight-plans/${PLAN_IDS.kgs}`]: storedPlan('eddb-eddm-c750-kgs', PLAN_IDS.kgs),
      [`DELETE /api/flight-plans/${PLAN_IDS.kgs}`]: () => new Response(null, { status: 204 }),
    });
    const { router } = await renderApp(`/history/${PLAN_IDS.kgs}`);

    await user.click(await screen.findByRole('button', { name: 'Delete plan' }));
    expect(screen.getByText('Delete this plan from your history?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/history');
    expect(api.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });

  it('does nothing when the delete is cancelled', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /api/pilot': pilot(),
      [`GET /api/flight-plans/${PLAN_IDS.kgs}`]: storedPlan('eddb-eddm-c750-kgs', PLAN_IDS.kgs),
    });
    await renderApp(`/history/${PLAN_IDS.kgs}`);

    await user.click(await screen.findByRole('button', { name: 'Delete plan' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Delete plan' })).toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === 'DELETE')).toEqual([]);
  });
});
