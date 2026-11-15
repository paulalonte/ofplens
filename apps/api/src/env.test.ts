import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const DATABASE_URL = 'postgres://ofplens:ofplens@localhost:5432/ofplens';

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv({ DATABASE_URL })).toEqual({
      DATABASE_URL,
      HOST: '127.0.0.1',
      PORT: 3000,
      LOG_LEVEL: 'info',
      PUBLIC_URL: 'http://localhost:5173',
      DEV_SIGN_IN: false,
      TRUST_PROXY: false,
      BRIEFING_MODEL: 'claude-haiku-5-5',
      BRIEFING_DAILY_LIMIT: 10,
      BRIEFING_GLOBAL_DAILY_LIMIT: 50,
    });
  });

  it('reads the sign-in settings, and wants each provider’s id and secret together', () => {
    const env = loadEnv({
      DATABASE_URL,
      PUBLIC_URL: 'https://ofplens.example.com/',
      GITHUB_CLIENT_ID: 'id',
      GITHUB_CLIENT_SECRET: 'secret',
      TRUST_PROXY: 'true',
    });
    expect(env).toMatchObject({
      PUBLIC_URL: 'https://ofplens.example.com',
      GITHUB_CLIENT_ID: 'id',
      TRUST_PROXY: true,
    });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(() => loadEnv({ DATABASE_URL, GOOGLE_CLIENT_ID: 'id' })).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(() => loadEnv({ DATABASE_URL, GITHUB_CLIENT_SECRET: 's' })).toThrow(/GITHUB_CLIENT_ID/);
  });

  it('allows development sign-in only on localhost', () => {
    expect(loadEnv({ DATABASE_URL, DEV_SIGN_IN: 'true' }).DEV_SIGN_IN).toBe(true);
    expect(
      loadEnv({ DATABASE_URL, DEV_SIGN_IN: 'true', PUBLIC_URL: 'http://127.0.0.1:4173' })
        .DEV_SIGN_IN,
    ).toBe(true);
    expect(() =>
      loadEnv({ DATABASE_URL, DEV_SIGN_IN: 'true', PUBLIC_URL: 'https://ofplens.example.com' }),
    ).toThrow(/DEV_SIGN_IN/);
    expect(() => loadEnv({ DATABASE_URL, DEV_SIGN_IN: 'maybe' })).toThrow(/DEV_SIGN_IN/);
  });

  it('switches briefings off without an API key, and reads the briefing settings', () => {
    expect(loadEnv({ DATABASE_URL }).ANTHROPIC_API_KEY).toBeUndefined();
    expect(
      loadEnv({ DATABASE_URL, BRIEFING_MODEL: 'claude-sonnet-5-5', BRIEFING_DAILY_LIMIT: '5' }),
    ).toMatchObject({ BRIEFING_MODEL: 'claude-sonnet-5-5', BRIEFING_DAILY_LIMIT: 5 });
    expect(() => loadEnv({ DATABASE_URL, BRIEFING_DAILY_LIMIT: '-1' })).toThrow(
      /BRIEFING_DAILY_LIMIT/,
    );
  });

  it('treats empty variables as unset (an empty key switches briefings off)', () => {
    const env = loadEnv({ DATABASE_URL, ANTHROPIC_API_KEY: '', BRIEFING_MODEL: '', PORT: '' });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env).toMatchObject({ BRIEFING_MODEL: 'claude-haiku-5-5', PORT: 3000 });
    expect(() => loadEnv({ DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('accepts an optional SimBrief URL (end-to-end tests) but only http(s)', () => {
    expect(
      loadEnv({ DATABASE_URL, SIMBRIEF_URL: 'http://127.0.0.1:4010/api/xml.fetcher.php' })
        .SIMBRIEF_URL,
    ).toBe('http://127.0.0.1:4010/api/xml.fetcher.php');
    expect(() => loadEnv({ DATABASE_URL, SIMBRIEF_URL: 'ftp://x' })).toThrow(/SIMBRIEF_URL/);
  });

  it('accepts an optional aviationweather.gov URL (end-to-end tests)', () => {
    expect(
      loadEnv({ DATABASE_URL, AVIATION_WEATHER_URL: 'http://127.0.0.1:4010/api/data' })
        .AVIATION_WEATHER_URL,
    ).toBe('http://127.0.0.1:4010/api/data');
    expect(loadEnv({ DATABASE_URL }).AVIATION_WEATHER_URL).toBeUndefined();
  });

  it('coerces PORT from a string', () => {
    expect(loadEnv({ DATABASE_URL, PORT: '4000' }).PORT).toBe(4000);
  });

  it('rejects a missing or non-Postgres DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ DATABASE_URL: 'mysql://localhost/x' })).toThrow(/DATABASE_URL/);
  });
});
