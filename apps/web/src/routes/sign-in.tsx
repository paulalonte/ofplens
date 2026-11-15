import { SIGN_IN_ERRORS, type SignInError } from '@ofplens/ofp';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useId, useState, type FormEvent } from 'react';
import { signInUrl, useDevSignIn, useSession } from '../api/auth';
import { Callout } from '../components/Callout';
import { safePath } from '../lib/safePath';

interface SignInSearch {
  /** Where to go after signing in. */
  redirect?: string;
  /** Why the last sign-in came back here. */
  error?: SignInError;
}

export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>): SignInSearch => {
    const redirect = safePath(search.redirect);
    const error = SIGN_IN_ERRORS.find((e) => e === search.error);
    return { ...(redirect && { redirect }), ...(error && { error }) };
  },
  component: SignInPage,
});

const ERROR_TEXT: Record<SignInError, string> = {
  cancelled: 'Sign-in was cancelled.',
  expired: 'That sign-in took too long or was started in another browser. Please try again.',
  failed: 'Signing in did not work. Please try again.',
};

function SignInPage() {
  const { providers, devSignIn } = useSession();
  const { redirect, error } = Route.useSearch();
  // Checked again here: validateSearch shapes the search, but this is what leaves the app.
  const after = safePath(redirect) ?? '/';

  return (
    <section className="mx-auto max-w-sm space-y-6 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Your flight plans, settings and briefings are kept for you alone.
        </p>
      </div>

      {error && <Callout tone="error">{ERROR_TEXT[error]}</Callout>}

      {providers.length > 0 && (
        <div className="space-y-3">
          {providers.map((provider) => (
            // A full-page navigation, not a fetch: the browser goes to the provider and back.
            <a
              key={provider.id}
              href={signInUrl(provider.id, after)}
              className="block w-full rounded-md border border-slate-300 bg-white px-4 py-2.5 text-center font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            >
              Continue with {provider.label}
            </a>
          ))}
          <p className="text-xs text-slate-500">
            We only read your name and picture to show who is signed in. No password is stored here.
          </p>
        </div>
      )}

      {devSignIn && <DevSignInForm after={after} />}

      {providers.length === 0 && !devSignIn && (
        <Callout>
          <p className="font-medium">No way to sign in is set up on this server.</p>
          <p className="text-sm">
            Add a GitHub or Google OAuth client to the API&apos;s environment (docs/AUTH.md), or
            DEV_SIGN_IN=true for local development.
          </p>
        </Callout>
      )}
    </section>
  );
}

function DevSignInForm({ after }: { after: string }) {
  const nameId = useId();
  const [name, setName] = useState('');
  const devSignIn = useDevSignIn();
  const router = useRouter();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    devSignIn.mutate({ name }, { onSuccess: () => void router.navigate({ href: after }) });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border border-dashed border-amber-400 p-4 dark:border-amber-700"
    >
      <div className="space-y-1">
        <h2 className="font-medium">Development sign-in</h2>
        <p className="text-xs text-slate-500">
          This server lets anyone sign in as any name, without a password. Only for development.
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={nameId} className="block text-sm font-medium">
          Pilot name
        </label>
        <input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          required
          autoComplete="off"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
        />
      </div>
      {devSignIn.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {devSignIn.error.message}
        </p>
      )}
      <button
        type="submit"
        disabled={devSignIn.isPending || name.trim() === ''}
        className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
      >
        Sign in as {name.trim() || '…'}
      </button>
    </form>
  );
}
