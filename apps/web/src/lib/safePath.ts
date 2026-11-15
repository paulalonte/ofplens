/**
 * A path inside this app to go to after signing in, or undefined. Anything else (another
 * site, //host, the API) is dropped, so a crafted link cannot send a pilot away.
 */
export function safePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return undefined;
  if (value.startsWith('/api/') || value.startsWith('/sign-in')) return undefined;
  return value;
}
