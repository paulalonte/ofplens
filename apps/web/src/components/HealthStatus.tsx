import { useHealth } from '../api/health';

type Tone = 'ok' | 'warn' | 'bad' | 'idle';

const toneClasses: Record<Tone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  idle: 'bg-slate-400 animate-pulse',
};

export function HealthStatus() {
  const { data, isPending, isError } = useHealth();

  let tone: Tone;
  let label: string;
  if (isPending) {
    tone = 'idle';
    label = 'Checking API…';
  } else if (isError) {
    tone = 'bad';
    label = 'API unreachable';
  } else if (data.db === 'up') {
    tone = 'ok';
    label = 'API ok, DB up';
  } else {
    tone = 'warn';
    label = 'API ok, DB down';
  }

  // On a phone only the dot shows (the words stay for screen readers, and as a tooltip).
  return (
    <p role="status" title={label} className="inline-flex items-center gap-2 text-sm">
      <span aria-hidden className={`size-2.5 rounded-full ${toneClasses[tone]}`} />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </p>
  );
}
