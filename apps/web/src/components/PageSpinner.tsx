/** Shown by the router while a page's loader runs longer than 300 ms. */
export function PageSpinner() {
  return (
    <div role="status" className="flex items-center gap-3 py-12 text-slate-500 dark:text-slate-400">
      <span
        aria-hidden
        className="size-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700 dark:border-slate-700 dark:border-t-slate-200"
      />
      <span>Loading…</span>
    </div>
  );
}
