import { z } from 'zod';

const ErrorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

/** An error from our API, carrying the `{ error: { code, message } }` envelope when there was one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiFetchOptions extends RequestInit {
  /** Non-2xx statuses whose body should be parsed with the schema instead of thrown. */
  acceptStatus?: number[];
}

/** Fetches a path under /api, validates the JSON body with `schema`, and throws ApiError otherwise. */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  { acceptStatus = [], ...init }: ApiFetchOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { accept: 'application/json', ...init.headers } });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the API');
  }

  const body: unknown = await res.json().catch(() => undefined);

  if (res.ok || acceptStatus.includes(res.status)) {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(res.status, 'INVALID_RESPONSE', `Unexpected response from ${path}`);
    }
    return parsed.data;
  }

  const envelope = ErrorEnvelope.safeParse(body);
  if (envelope.success) {
    throw new ApiError(res.status, envelope.data.error.code, envelope.data.error.message);
  }
  throw new ApiError(res.status, 'HTTP_ERROR', `Request to ${path} failed (${res.status})`);
}
