import { PilotSettings, WEIGHT_UNITS, weightUnitLabel, type WeightUnit } from '@ofplens/ofp';
import { Link } from '@tanstack/react-router';
import { useId, useState, type FormEvent } from 'react';
import { usePilot, useSavePilot } from '../../api/pilot';

export function SettingsPage() {
  const pilot = usePilot();

  return (
    <section className="max-w-md space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-slate-600 dark:text-slate-400">
          OFP Lens loads your latest plan from SimBrief with this username.
        </p>
      </div>

      {pilot.isPending ? (
        <p className="text-slate-500">Loading settings…</p>
      ) : pilot.isError ? (
        <p role="alert" className="text-red-600 dark:text-red-400">
          Could not load your settings: {pilot.error.message}
        </p>
      ) : (
        // Rendered only once settings have loaded, so the form starts from the saved values.
        // Not keyed on them: saving updates the cache and must not remount the form.
        <SettingsForm initial={pilot.data} />
      )}
    </section>
  );
}

interface FormProps {
  initial: PilotSettings | null;
}

function SettingsForm({ initial }: FormProps) {
  const save = useSavePilot();
  const [username, setUsername] = useState(initial?.simbriefUsername ?? '');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(initial?.weightUnit ?? 'kgs');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const usernameId = useId();
  const errorId = useId();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = PilotSettings.safeParse({ simbriefUsername: username, weightUnit });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Check your username');
      return;
    }
    setFieldError(null);
    save.mutate(parsed.data);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div className="space-y-1.5">
        <label htmlFor={usernameId} className="block text-sm font-medium">
          SimBrief username
        </label>
        <input
          id={usernameId}
          name="simbriefUsername"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            save.reset();
          }}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? errorId : undefined}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-900"
        />
        {fieldError ? (
          <p id={errorId} className="text-sm text-red-600 dark:text-red-400">
            {fieldError}
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            As shown in your SimBrief account settings, not your Navigraph email.
          </p>
        )}
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Show weights in</legend>
        <div className="flex gap-4">
          {WEIGHT_UNITS.map((unit) => (
            <label key={unit} className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="weightUnit"
                value={unit}
                checked={weightUnit === unit}
                onChange={() => {
                  setWeightUnit(unit);
                  save.reset();
                }}
              />
              {weightUnit === unit ? (
                <strong>{weightUnitLabel(unit)}</strong>
              ) : (
                weightUnitLabel(unit)
              )}
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          Plans keep their own unit; this only changes what you see first.
        </p>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {save.isSuccess && (
          <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
            Saved.{' '}
            <Link to="/" className="underline">
              Load your latest plan
            </Link>
          </p>
        )}
        {save.isError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {save.error.message}
          </p>
        )}
      </div>
    </form>
  );
}
