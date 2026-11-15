import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { AppError } from './errors';

/**
 * Requests per minute for the endpoints that call someone else (SimBrief, aviationweather.gov,
 * Claude) or start a sign-in. Counted per pilot when signed in, per address otherwise.
 *
 * The counts live in each API pod's memory: with two pods a pilot gets up to twice the limit.
 * That is fine for protecting upstreams from runaway loops; a shared store (Redis) would make
 * them exact.
 */
export interface RateLimits {
  simbrief: number;
  weather: number;
  hazards: number;
  briefing: number;
  signIn: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  simbrief: 10,
  weather: 20,
  hazards: 10,
  briefing: 5,
  signIn: 20,
};

export async function registerRateLimits(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    // Only routes that ask for a limit (see perMinute) are limited.
    global: false,
    // After the session hook, so the key can be the pilot.
    hook: 'preHandler',
    keyGenerator: (request) => (request.pilot ? `pilot:${request.pilot.id}` : `ip:${request.ip}`),
    errorResponseBuilder: (_request, context) =>
      new AppError(429, 'RATE_LIMITED', `Too many requests. Try again in ${context.after}.`),
  });
}

/** Route config for a limit of `max` requests per minute; none when `max` is undefined. */
export const perMinute = (max: number | undefined) =>
  max === undefined ? {} : { rateLimit: { max, timeWindow: 60_000 } };
