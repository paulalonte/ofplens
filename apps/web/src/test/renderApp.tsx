import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { createApp } from '../router';

/** Renders the whole app (layout, router, query client) at `path`, with fresh state. */
export async function renderApp(path = '/') {
  const { queryClient, router } = createApp({
    retry: false,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  // The layout is there once the session is known.
  await screen.findByRole('contentinfo');
  return { ...result, router, queryClient };
}
