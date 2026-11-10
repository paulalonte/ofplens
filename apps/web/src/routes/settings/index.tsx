import { createFileRoute } from '@tanstack/react-router';
import { pilotQuery, usePilot } from '../../api/pilot';
import { SettingsForm } from './-components/SettingsForm';

export const Route = createFileRoute('/settings/')({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(pilotQuery),
  component: SettingsPage,
});

function SettingsPage() {
  const pilot = usePilot();

  return (
    <section className="max-w-md space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-slate-600 dark:text-slate-400">
          OFP Lens loads your latest plan from SimBrief with this username.
        </p>
      </div>

      {/* Starts from the saved values. Not keyed on them: saving updates the cache and must
          not remount the form. */}
      <SettingsForm initial={pilot} />
    </section>
  );
}
