import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi } from '../../test/mockApi';
import { jsonResponse } from '../../test/render';
import { renderApp } from '../../test/renderApp';

describe('Settings page', () => {
  it('starts empty with kg selected when nothing is saved', async () => {
    mockApi({ 'GET /api/pilot': () => jsonResponse({ pilot: null }) });
    await renderApp('/settings');

    expect(await screen.findByLabelText('SimBrief username')).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'kg' })).toBeChecked();
  });

  it('shows the saved settings', async () => {
    mockApi({
      'GET /api/pilot': () =>
        jsonResponse({ pilot: { simbriefUsername: 'jetpilot', weightUnit: 'lbs' } }),
    });
    await renderApp('/settings');

    expect(await screen.findByLabelText('SimBrief username')).toHaveValue('jetpilot');
    expect(screen.getByRole('radio', { name: 'lb' })).toBeChecked();
  });

  it('saves the username and unit, then confirms', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /api/pilot': () => jsonResponse({ pilot: null }),
      'PUT /api/pilot': ({ body }) => jsonResponse({ pilot: body }),
    });
    await renderApp('/settings');

    await user.type(await screen.findByLabelText('SimBrief username'), '  jetpilot ');
    await user.click(screen.getByRole('radio', { name: 'lb' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // (The header's API indicator is also a role="status", so find the message by its text.)
    const saved = await screen.findByText(/^Saved\./);
    expect(saved).toHaveTextContent('Saved. Load your latest plan');
    expect(saved).toHaveAttribute('role', 'status');
    expect(api.calls).toContainEqual({
      method: 'PUT',
      path: '/api/pilot',
      body: { simbriefUsername: 'jetpilot', weightUnit: 'lbs' },
    });
  });

  it('explains an invalid username without calling the API', async () => {
    const user = userEvent.setup();
    const api = mockApi({ 'GET /api/pilot': () => jsonResponse({ pilot: null }) });
    await renderApp('/settings');

    const input = await screen.findByLabelText('SimBrief username');
    await user.type(input, 'jet pilot');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('A SimBrief username has no spaces')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(api.calls.filter((c) => c.method === 'PUT')).toEqual([]);
  });

  it('shows the server’s message when saving fails', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/pilot': () => jsonResponse({ pilot: null }),
      'PUT /api/pilot': () => apiError(500, 'INTERNAL_ERROR', 'Something went wrong'),
    });
    await renderApp('/settings');

    await user.type(await screen.findByLabelText('SimBrief username'), 'jetpilot');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong'),
    );
  });
});
