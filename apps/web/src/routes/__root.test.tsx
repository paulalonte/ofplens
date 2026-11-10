import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../test/mockApi';
import { jsonResponse } from '../test/render';
import { renderApp } from '../test/renderApp';

describe('Layout', () => {
  it('shows a friendly page for unknown URLs, such as old /plans/ links', async () => {
    mockApi({ 'GET /api/pilot': () => jsonResponse({ pilot: null }) });
    await renderApp('/plans/6c183703-1586-4f8e-81a2-7adc93f18943');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: 'History' })).toHaveAttribute('href', '/history');
    expect(within(main).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByText(/For flight simulation use only/)).toBeInTheDocument();
  });

  it('links History, Settings and home in the header', async () => {
    mockApi({
      'GET /api/pilot': () => jsonResponse({ pilot: null }),
      'GET /api/flight-plans': () => jsonResponse({ items: [], nextCursor: null }),
    });
    await renderApp('/history');

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect([...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/',
      '/history',
      '/settings',
    ]);
  });
});
