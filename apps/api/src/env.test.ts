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
    });
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
