import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi } from '../test/mockApi';
import { fixtureListItem, fixturePlan, PLAN_IDS } from '../test/plans';
import { jsonResponse } from '../test/render';
import { renderApp } from '../test/renderApp';

/**
 * How pages get their data: route loaders fill the query cache before the page renders,
 * the router shows a spinner for slow loads and an error page when a loader fails.
 */

const pilot = () => jsonResponse({ pilot: { simbriefUsername: 'jetpilot', weightUnit: 'kgs' } });
const history = () =>
  jsonResponse({ items: [fixtureListItem('eddb-eddm-c750-kgs', PLAN_IDS.kgs)], nextCursor: null });
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('route loading', () => {
  it('shows a spinner while a slow page loads, then the page', async () => {
    mockApi({
      'GET /api/pilot': pilot,
      'GET /api/flight-plans': async () => {
        await delay(700);
        return history();
      },
    });
    await renderApp('/history');

    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'History' }, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('shows an error page when a loader fails, and "Try again" reloads it', async () => {
    const user = userEvent.setup();
    let broken = true;
    mockApi({
      'GET /api/pilot': pilot,
      'GET /api/flight-plans': () =>
        broken ? apiError(500, 'INTERNAL_ERROR', 'Something went wrong') : history(),
    });
    await renderApp('/history');

    expect(
      await screen.findByRole('heading', { name: 'Could not load this page' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');

    broken = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /N70P/ })).toBeInTheDocument();
  });

  it('fetches a plan when its link is hovered, so opening it needs no new request', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /api/pilot': pilot,
      'GET /api/flight-plans': history,
      [`GET /api/flight-plans/${PLAN_IDS.kgs}`]: () =>
        jsonResponse({
          id: PLAN_IDS.kgs,
          importedAt: '2026-11-09T21:00:00Z',
          plan: fixturePlan('eddb-eddm-c750-kgs'),
        }),
    });
    await renderApp('/history');
    const detailCalls = () =>
      api.calls.filter((c) => c.path === `/api/flight-plans/${PLAN_IDS.kgs}`);

    const link = await screen.findByRole('link', { name: /N70P/ });
    await user.hover(link);
    await waitFor(() => expect(detailCalls()).toHaveLength(1));

    await user.click(link);

    expect(await screen.findByRole('heading', { level: 1, name: 'N70P' })).toBeInTheDocument();
    expect(detailCalls()).toHaveLength(1);
  });
});
