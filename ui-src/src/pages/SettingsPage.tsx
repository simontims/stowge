import { PageHeader } from "../components/ui/PageHeader";

export function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Configure your Stowge instance and administration features."
        action={null}
      />

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
        <p className="text-sm text-neutral-400">
          System-level settings will appear here as they are added.
        </p>
      </section>
    </div>
  );
}
