import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { createQueryClient } from '../queryClient';
import { createAppRouter } from '../router';

/** Renders the whole app (layout, router, query client) at `path`, with fresh state. */
export async function renderApp(path = '/') {
  const queryClient = createQueryClient({ retry: false });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole('navigation', { name: 'Main' });
  return { ...result, router, queryClient };
}
