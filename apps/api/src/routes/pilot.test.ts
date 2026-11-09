import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app';
import { createInMemoryPilotRepository, testDeps } from '../testing/fakes';

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/pilot', () => {
  it('returns null before any settings are saved', async () => {
    app = await buildApp(testDeps());

    const res = await app.inject({ method: 'GET', url: '/api/pilot' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pilot: null });
  });

  it('returns the saved settings', async () => {
    const pilots = createInMemoryPilotRepository({
      simbriefUsername: 'jetpilot',
      weightUnit: 'lbs',
    });
    app = await buildApp(testDeps({ pilots }));

    const res = await app.inject({ method: 'GET', url: '/api/pilot' });

    expect(res.json()).toEqual({ pilot: { simbriefUsername: 'jetpilot', weightUnit: 'lbs' } });
  });
});

describe('PUT /api/pilot', () => {
  it('saves trimmed settings and returns them', async () => {
    const pilots = createInMemoryPilotRepository();
    app = await buildApp(testDeps({ pilots }));

    const res = await app.inject({
      method: 'PUT',
      url: '/api/pilot',
      payload: { simbriefUsername: '  jetpilot ', weightUnit: 'kgs' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pilot: { simbriefUsername: 'jetpilot', weightUnit: 'kgs' } });
    expect(pilots.saved).toEqual([{ simbriefUsername: 'jetpilot', weightUnit: 'kgs' }]);

    const after = await app.inject({ method: 'GET', url: '/api/pilot' });
    expect(after.json()).toEqual({ pilot: { simbriefUsername: 'jetpilot', weightUnit: 'kgs' } });
  });

  it.each([
    ['an empty username', { simbriefUsername: '   ', weightUnit: 'kgs' }, /simbriefUsername/],
    ['a username with spaces', { simbriefUsername: 'jet pilot', weightUnit: 'kgs' }, /no spaces/],
    ['an unknown unit', { simbriefUsername: 'jetpilot', weightUnit: 'tons' }, /weightUnit/],
    ['a missing unit', { simbriefUsername: 'jetpilot' }, /weightUnit/],
  ])('rejects %s with 400 and saves nothing', async (_, payload, message) => {
    const pilots = createInMemoryPilotRepository();
    app = await buildApp(testDeps({ pilots }));

    const res = await app.inject({ method: 'PUT', url: '/api/pilot', payload });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(message);
    expect(pilots.saved).toEqual([]);
  });
});
