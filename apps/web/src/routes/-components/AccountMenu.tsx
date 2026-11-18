import { useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { useSignOut } from '../../api/auth';

type Props = {
  name: string;
  /** The picture from Google or GitHub, saved at sign-in. Null: initials instead. */
  avatarUrl: string | null;
};

/**
 * The pilot's picture in the header; a click opens a small menu with their name and "Sign out"
 * (room for more later). A disclosure button, not an ARIA menu: Tab moves through the items,
 * Escape or a click outside closes it and returns focus to the picture.
 */
export function AccountMenu({ name, avatarUrl }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const signOut = useSignOut();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={`Account: ${name}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="block rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
      >
        <Avatar name={name} avatarUrl={avatarUrl} />
      </button>

      {open && (
        <div
          id={menuId}
          className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <p className="truncate px-3 py-2 font-medium" title={name}>
            {name}
          </p>
          <div className="border-t border-slate-200 dark:border-slate-700" />
          <button
            type="button"
            disabled={signOut.isPending}
            onClick={() =>
              signOut.mutate(undefined, { onSettled: () => void navigate({ to: '/sign-in' }) })
            }
            className="block w-full px-3 py-2 text-left hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** The provider's picture, or the name's initials if there is none or it fails to load. */
function Avatar({ name, avatarUrl }: Props) {
  const [failed, setFailed] = useState(false);
  const size = 'size-8 rounded-full';

  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt=""
        width={32}
        height={32}
        // Google's picture links can refuse requests that carry another site's address.
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${size} object-cover`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${size} flex items-center justify-center bg-sky-600 text-xs font-semibold text-white`}
    >
      {initials(name)}
    </span>
  );
}

export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s._@-]+/)
    .filter(Boolean);
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}
