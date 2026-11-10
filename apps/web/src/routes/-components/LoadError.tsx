import { Link } from '@tanstack/react-router';
import { ApiError } from '../../api/client';
import { Callout } from '../../components/Callout';

/** Why "Load latest plan" failed, with the fix: Settings for user problems, retry for outages. */
export function LoadError({ error }: { error: Error }) {
  const code = error instanceof ApiError ? error.code : undefined;
  const fixInSettings = code === 'USERNAME_REQUIRED' || code === 'SIMBRIEF_NOT_FOUND';
  const transient = code === 'SIMBRIEF_UNAVAILABLE' || code === 'NETWORK_ERROR';

  return (
    <Callout tone="error">
      <p className="font-medium">Could not load your latest plan</p>
      <p className="text-sm">{error.message}</p>
      {fixInSettings && (
        <p className="text-sm">
          <Link to="/settings" className="underline">
            Check your username in Settings
          </Link>
        </p>
      )}
      {transient && <p className="text-sm">This is usually temporary. Try again in a moment.</p>}
    </Callout>
  );
}
