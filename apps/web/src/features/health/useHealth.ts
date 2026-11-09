import { queryOptions, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from '../../api/client';

export const Health = z.object({
  status: z.enum(['ok', 'error']),
  db: z.enum(['up', 'down']),
});
export type Health = z.infer<typeof Health>;

export const healthQuery = queryOptions({
  queryKey: ['health'],
  // 503 means "API up, database down": that is data to show, not a failed request.
  queryFn: () => apiFetch('/api/health', Health, { acceptStatus: [503] }),
  refetchInterval: 10_000,
  retry: false,
});

export function useHealth() {
  return useQuery(healthQuery);
}
