import { useHealth } from './useHealth';

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

  return (
    <p role="status" className="inline-flex items-center gap-2 text-sm">
      <span aria-hidden className={`size-2.5 rounded-full ${toneClasses[tone]}`} />
      {label}
    </p>
  );
}
