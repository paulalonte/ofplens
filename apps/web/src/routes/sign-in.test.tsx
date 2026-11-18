import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, SIGNED_OUT, TEST_SESSION } from '../test/mockApi';
import { jsonResponse } from '../test/render';
import { renderApp } from '../test/renderApp';

const noPlans = () => jsonResponse({ items: [], nextCursor: null });

describe('signed out', () => {
  it('sends any page to sign-in, remembering where the pilot wanted to go', async () => {
    const { calls } = mockApi({ 'GET /api/auth/session': () => jsonResponse(SIGNED_OUT) });
    const { router } = await renderApp('/history?page=2');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(screen.getByRole('link', { name: 'Continue with GitHub' })).toHaveAttribute(
      'href',
      `/api/auth/github/start?redirect=${encodeURIComponent('/history?page=2')}`,
    );
    // No navigation to pages that need a pilot, and no pilot data was asked for.
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(calls).toEqual([]);
    expect(screen.getByText(/For flight simulation use only/)).toBeInTheDocument();
  });

  it('explains why the last sign-in came back', async () => {
    mockApi({ 'GET /api/auth/session': () => jsonResponse(SIGNED_OUT) });
    await renderApp('/sign-in?error=cancelled');

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in was cancelled.');
  });

  it('drops a redirect that leaves the app', async () => {
    mockApi({ 'GET /api/auth/session': () => jsonResponse(SIGNED_OUT) });
    await renderApp('/sign-in?redirect=https%3A%2F%2Fevil.example');

    expect(await screen.findByRole('link', { name: 'Continue with GitHub' })).toHaveAttribute(
      'href',
      `/api/auth/github/start?redirect=${encodeURIComponent('/')}`,
    );
  });

  it('says so when the server has no way to sign in', async () => {
    mockApi({
      'GET /api/auth/session': () => jsonResponse({ ...SIGNED_OUT, providers: [] }),
    });
    await renderApp('/');

    expect(await screen.findByText('No way to sign in is set up on this server.')).toBeVisible();
  });

  it('signs in with the development form and goes on to the page asked for', async () => {
    let session: object = { ...SIGNED_OUT, providers: [], devSignIn: true };
    const { calls } = mockApi({
      'GET /api/auth/session': () => jsonResponse(session),
      'POST /api/auth/dev': () => {
        session = TEST_SESSION;
        return new Response(null, { status: 204 });
      },
      'GET /api/flight-plans': noPlans,
    });
    const { router } = await renderApp('/history');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Pilot name'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Sign in as Ana' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/history'));
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(calls[0]).toEqual({ method: 'POST', path: '/api/auth/dev', body: { name: 'Ana' } });
  });
});

describe('signed in', () => {
  it('shows the pilot and signs out, forgetting everything cached', async () => {
    let session: object = TEST_SESSION;
    mockApi({
      'GET /api/auth/session': () => jsonResponse(session),
      'POST /api/auth/sign-out': () => {
        session = SIGNED_OUT;
        return new Response(null, { status: 204 });
      },
      'GET /api/flight-plans': noPlans,
    });
    const { router, queryClient } = await renderApp('/history');
    const user = userEvent.setup();

    const header = screen.getByRole('banner');
    const account = within(header).getByRole('button', { name: 'Account: Test Pilot' });
    expect(account).toHaveAttribute('aria-expanded', 'false');
    await user.click(account);
    expect(account).toHaveAttribute('aria-expanded', 'true');
    expect(within(header).getByText('Test Pilot')).toBeInTheDocument();
    await user.click(within(header).getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Test Pilot')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(queryClient.getQueryData(['flight-plans'])).toBeUndefined();
  });

  it('leaves the sign-in page for the app', async () => {
    mockApi({ 'GET /api/flight-plans': noPlans });
    const { router } = await renderApp('/sign-in?redirect=%2Fhistory');

    await waitFor(() => expect(router.state.location.pathname).toBe('/history'));
  });

  it('goes to sign-in when the session ends while using the app', async () => {
    let session: object = TEST_SESSION;
    mockApi({
      'GET /api/auth/session': () => jsonResponse(session),
      'GET /api/flight-plans': () => {
        // Expired on the server: the next request learns it.
        session = SIGNED_OUT;
        return apiError(401, 'UNAUTHENTICATED', 'Sign in to use OFP Lens.');
      },
    });
    const { router } = await renderApp('/history');

    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(router.state.location.search).toEqual({ redirect: '/history' });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
