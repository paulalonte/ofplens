import { parseOfp } from '@ofplens/ofp';
import { loadFixture } from '@ofplens/ofp/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app';
import { SimbriefNotFoundError, SimbriefUpstreamError } from '../simbrief';
import { createFakeSimbrief, createInMemoryPilotRepository, testDeps } from '../testing/fakes';

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const savedPilot = () =>
  createInMemoryPilotRepository({ simbriefUsername: 'jetpilot', weightUnit: 'kgs' });

const errorOf = (body: unknown) => (body as { error: { code: string; message: string } }).error;

describe('GET /api/simbrief/latest', () => {
  it('fetches with the saved username and returns the parsed plan', async () => {
    const raw = loadFixture('ksfo-kjfk-b739-lbs');
    const simbrief = createFakeSimbrief(() => raw);
    app = await buildApp(testDeps({ pilots: savedPilot(), simbrief }));

    const res = await app.inject({ method: 'GET', url: '/api/simbrief/latest' });

    expect(res.statusCode).toBe(200);
    expect(simbrief.requests).toEqual(['jetpilot']);
    expect(res.json()).toEqual(parseOfp(loadFixture('ksfo-kjfk-b739-lbs')));
  });

  it('prefers ?username= over the saved one', async () => {
    const simbrief = createFakeSimbrief(() => loadFixture('eddb-eddm-c750-kgs'));
    app = await buildApp(testDeps({ pilots: savedPilot(), simbrief }));

    const res = await app.inject({ method: 'GET', url: '/api/simbrief/latest?username=other' });

    expect(res.statusCode).toBe(200);
    expect(simbrief.requests).toEqual(['other']);
  });

  it('works without saved settings when a username is given', async () => {
    const simbrief = createFakeSimbrief(() => loadFixture('eddf-lepa-a339-noalt'));
    app = await buildApp(testDeps({ simbrief }));

    const res = await app.inject({ method: 'GET', url: '/api/simbrief/latest?username=jetpilot' });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ alternate: unknown }>().alternate).toBeNull();
  });

  it('asks for a username (400) when none is saved or given, without calling SimBrief', async () => {
    const simbrief = createFakeSimbrief();
    app = await buildApp(testDeps({ simbrief }));

    const res = await app.inject({ method: 'GET', url: '/api/simbrief/latest' });

    expect(res.statusCode).toBe(400);
    expect(errorOf(res.json())).toEqual({
      code: 'USERNAME_REQUIRED',
      message: 'Set your SimBrief username in Settings first.',
    });
    expect(simbrief.requests).toEqual([]);
  });

  it('rejects an invalid ?username= with 400', async () => {
    app = await buildApp(testDeps());

    const res = await app.inject({
      method: 'GET',
      url: '/api/simbrief/latest?username=jet%20pilot',
    });

    expect(res.statusCode).toBe(400);
    expect(errorOf(res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('passes SimBrief’s unknown user through as 404 with its helpful message', async () => {
    const simbrief = createFakeSimbrief(() => {
      throw new SimbriefNotFoundError(
        'SimBrief has no flight plan for "jetpilot" (Unknown UserID).',
      );
    });
    app = await buildApp(testDeps({ pilots: savedPilot(), simbrief }));

    const res = await app.inject({ method: 'GET', url: '/api/simbrief/latest' });

    expect(res.statusCode).toBe(404);
    expect(errorOf(res.json())).toEqual({
      code: 'SIMBRIEF_NOT_FOUND',
      message: 'SimBrief has no flight plan for "jetpilot" (Unknown UserID).',
    });
  });

  it('reports SimBrief being down as 502', async () => {
    const simbrief = createFakeSimbrief(() => {
      throw new SimbriefUpstreamError('SimBrief did not answer within 10 s');
    });
    app = await buildApp(testDeps({ pilots: savedPilot(), simbrief }));

    const res = await app.inject({ method: 'GET', url: '/api/simbrief/latest' });

    expect(res.statusCode).toBe(502);
    expect(errorOf(res.json())).toEqual({
      code: 'SIMBRIEF_UNAVAILABLE',
      message: 'SimBrief did not answer within 10 s',
    });
  });

  it('reports a plan it cannot read as 422, naming the bad field', async () => {
    const raw = loadFixture('eddb-eddm-c750-kgs');
    (raw.fuel as Record<string, unknown>).plan_ramp = 'lots';
    app = await buildApp(
      testDeps({ pilots: savedPilot(), simbrief: createFakeSimbrief(() => raw) }),
    );

    const res = await app.inject({ method: 'GET', url: '/api/simbrief/latest' });

    expect(res.statusCode).toBe(422);
    const error = errorOf(res.json());
    expect(error.code).toBe('OFP_INVALID');
    expect(error.message).toMatch(/^Your latest SimBrief plan could not be read: /);
    expect(error.message).toContain('fuel.plan_ramp');
  });

  it('turns anything else into a generic 500', async () => {
    const simbrief = createFakeSimbrief(() => {
      throw new Error('bug with secret details');
    });
    app = await buildApp(testDeps({ pilots: savedPilot(), simbrief }));

    const res = await app.inject({ method: 'GET', url: '/api/simbrief/latest' });

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret');
  });
});
