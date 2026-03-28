import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";

export function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Configure your Stowge instance and administration features"
        action={null}
      />

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
        <p className="text-sm text-neutral-400">
          Manage system settings and administration areas.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link to="/settings/ai" className="rounded-md border border-neutral-700 px-3 py-1.5 text-neutral-300 hover:bg-neutral-800/60">
            AI
          </Link>
          <Link to="/settings/locations" className="rounded-md border border-neutral-700 px-3 py-1.5 text-neutral-300 hover:bg-neutral-800/60">
            Locations
          </Link>
          <Link to="/settings/users" className="rounded-md border border-neutral-700 px-3 py-1.5 text-neutral-300 hover:bg-neutral-800/60">
            Users
          </Link>
        </div>
      </section>
    </div>
  );
}
