import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi } from '../test/mockApi';
import { fixturePlan } from '../test/plans';
import { jsonResponse } from '../test/render';
import { renderApp } from '../test/renderApp';

const pilot =
  (weightUnit: 'kgs' | 'lbs' = 'kgs') =>
  () =>
    jsonResponse({ pilot: { simbriefUsername: 'jetpilot', weightUnit } });

describe('Home: load latest plan', () => {
  it('asks for a username first and keeps the button disabled', async () => {
    const api = mockApi({ 'GET /api/pilot': () => jsonResponse({ pilot: null }) });
    await renderApp('/');

    expect(await screen.findByText('Set your SimBrief username first.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(screen.getByRole('button', { name: 'Load latest plan' })).toBeDisabled();
    expect(api.calls.map((c) => c.path)).toEqual(['/api/pilot']);
  });

  it('does not fetch from SimBrief until the button is pressed', async () => {
    const api = mockApi({ 'GET /api/pilot': pilot() });
    await renderApp('/');

    expect(
      await screen.findByText('Generate a flight on SimBrief, then load it here.'),
    ).toBeInTheDocument();
    expect(screen.getByText('jetpilot')).toBeInTheDocument();
    expect(api.calls.map((c) => c.path)).toEqual(['/api/pilot']);
  });

  it('loads and shows the latest plan in one click', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /api/pilot': pilot(),
      'GET /api/simbrief/latest': () => jsonResponse(fixturePlan('ksfo-kjfk-b739-lbs')),
    });
    await renderApp('/');

    await user.click(await screen.findByRole('button', { name: 'Load latest plan' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'UAL1234' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload latest plan' })).toBeEnabled();
    expect(api.calls.map((c) => c.path)).toEqual(['/api/pilot', '/api/simbrief/latest']);
    expect(screen.queryByRole('navigation', { name: 'Sample plans' })).not.toBeInTheDocument();
  });

  it('shows weights in the pilot’s preferred unit', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/pilot': pilot('lbs'),
      'GET /api/simbrief/latest': () => jsonResponse(fixturePlan('eddb-eddm-c750-kgs')),
    });
    await renderApp('/');

    await user.click(await screen.findByRole('button', { name: 'Load latest plan' }));

    const fuel = await screen.findByRole('region', { name: 'Fuel' });
    expect(within(fuel).getByText('5,362 lb')).toBeInTheDocument(); // 2,432 kg block fuel
  });

  it('explains an unknown SimBrief user and points to Settings', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/pilot': pilot(),
      'GET /api/simbrief/latest': () =>
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
    expect(alert).toHaveTextContent('SimBrief has no flight plan for "jetpilot" (Unknown UserID).');
    expect(
      within(alert).getByRole('link', { name: 'Check your username in Settings' }),
    ).toBeInTheDocument();
  });

  it('suggests trying again when SimBrief is unavailable', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/pilot': pilot(),
      'GET /api/simbrief/latest': () =>
        apiError(502, 'SIMBRIEF_UNAVAILABLE', 'SimBrief did not answer within 10 s'),
    });
    await renderApp('/');

    await user.click(await screen.findByRole('button', { name: 'Load latest plan' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('SimBrief did not answer within 10 s');
    expect(alert).toHaveTextContent('This is usually temporary.');
    expect(within(alert).queryByRole('link')).not.toBeInTheDocument();
  });
});
