import { Link } from '@tanstack/react-router';
import { SAMPLE_NAMES } from '../features/briefing/samples';

export function HomePage() {
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Briefing</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Your SimBrief flight plan will show up here.
        </p>
      </div>

      {SAMPLE_NAMES.length > 0 && (
        <nav aria-label="Sample plans" className="space-y-2">
          <h2 className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
            Sample plans (development)
          </h2>
          <ul className="flex flex-wrap gap-2">
            {SAMPLE_NAMES.map((name) => (
              <li key={name}>
                <Link
                  to="/sample/$name"
                  params={{ name }}
                  className="inline-block rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  {name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </section>
  );
}
