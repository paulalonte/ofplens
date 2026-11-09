import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithQuery } from '../../test/render';
import { HealthStatus } from './HealthStatus';

function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('<HealthStatus />', () => {
  it('shows API ok, DB up on a 200', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ status: 'ok', db: 'up' })));

    renderWithQuery(<HealthStatus />);

    expect(screen.getByRole('status')).toHaveTextContent('Checking API…');
    expect(await screen.findByText('API ok, DB up')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything());
  });

  it('shows DB down on a 503 instead of treating it as an outage', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ status: 'error', db: 'down' }, 503)));

    renderWithQuery(<HealthStatus />);

    expect(await screen.findByText('API ok, DB down')).toBeInTheDocument();
  });

  it('shows API unreachable when the request fails', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    renderWithQuery(<HealthStatus />);

    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
  });

  it('shows API unreachable when the dev proxy cannot reach Fastify', async () => {
    stubFetch(() => Promise.resolve(new Response('', { status: 502 })));

    renderWithQuery(<HealthStatus />);

    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
  });
});
