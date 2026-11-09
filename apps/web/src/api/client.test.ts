import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { jsonResponse } from '../test/render';
import { ApiError, apiFetch } from './client';

const Thing = z.object({ id: z.string() });

afterEach(() => vi.unstubAllGlobals());

describe('apiFetch', () => {
  it('returns the parsed body on success', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(jsonResponse({ id: 'a1' })));
    await expect(apiFetch('/api/thing', Thing)).resolves.toEqual({ id: 'a1' });
  });

  it('turns the error envelope into an ApiError', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        jsonResponse({ error: { code: 'PLAN_NOT_FOUND', message: 'No such plan' } }, 404),
      ),
    );
    await expect(apiFetch('/api/thing', Thing)).rejects.toMatchObject({
      status: 404,
      code: 'PLAN_NOT_FOUND',
      message: 'No such plan',
    });
  });

  it('rejects a 2xx body that does not match the schema', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(jsonResponse({ nope: true })));
    await expect(apiFetch('/api/thing', Thing)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('maps network failures to NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const err: unknown = await apiFetch('/api/thing', Thing).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});
