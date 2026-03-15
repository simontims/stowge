import { Link } from "react-router-dom";
import { ArrowRight, Users } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";

export function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Configure your Stowge instance and administration features."
        action={null}
      />

      <section className="grid gap-3 sm:grid-cols-2">
        <Link
          to="/settings/users"
          className="group rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 hover:border-neutral-700 transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-100">
                <Users size={15} />
                Users
              </div>
              <p className="mt-1 text-sm text-neutral-500">
                Add, edit, and remove user accounts.
              </p>
            </div>
            <ArrowRight
              size={16}
              className="text-neutral-600 group-hover:text-neutral-300 transition-colors"
            />
          </div>
        </Link>
      </section>
    </div>
  );
}
