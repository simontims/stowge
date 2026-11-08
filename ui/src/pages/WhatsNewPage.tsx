import { useEffect, useState } from "react";
import { PageHeader } from "../components/ui/PageHeader";
import { apiRequest } from "../lib/api";
import { useCurrentUser, useSetCurrentUser } from "../lib/UserContext";
import { groupByVersion } from "../lib/whatsNew";
import type { CurrentUser, WhatsNewHistoryNote } from "../lib/types";

/** Full history of what changed, newest first. Opening it clears the unread dot. */
export function WhatsNewPage() {
  const user = useCurrentUser();
  const setUser = useSetCurrentUser();
  const [notes, setNotes] = useState<WhatsNewHistoryNote[] | null>(null);
  const [error, setError] = useState("");
  const hasUnseen = (user.whats_new?.unseen.length ?? 0) > 0;

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ notes: WhatsNewHistoryNote[] }>("/api/whats-new")
      .then(async (data) => {
        if (cancelled) return;
        setNotes(data.notes);
        // Keep the "New" badges for this visit, but clear the dot for the next one.
        if (hasUnseen) {
          try {
            setUser(await apiRequest<CurrentUser>("/api/me/whats-new/seen", { method: "POST" }));
          } catch {
            // Best effort.
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the release notes.");
      });
    return () => {
      cancelled = true;
    };
    // Load once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Release notes"
        description="What changed in each version of Stowge, newest first."
      />

      {error && <p className="text-sm text-danger-400">{error}</p>}
      {!notes && !error && <p className="text-sm text-subtle">Loading...</p>}

      {notes && notes.length === 0 && (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-border py-16 text-sm text-faint">
          No release notes yet.
        </div>
      )}

      {groupByVersion(notes ?? []).map((group) => (
        <section key={group.version} aria-labelledby={`version-${group.version}`}>
          <h2 id={`version-${group.version}`} className="mb-1 text-xs font-semibold uppercase tracking-wider text-subtle">
            Version {group.version}
          </h2>
          <ul className="divide-y divide-border border-y border-border">
            {group.notes.map((note) => (
              <li key={note.id} id={note.id} className="flex items-baseline gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-heading">
                    <span className="font-medium">{note.title}</span>
                    {note.unread && (
                      <span className="ml-2 rounded bg-success-600/20 px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-success-300">
                        New
                      </span>
                    )}
                  </p>
                  {note.summary && <p className="mt-0.5 text-sm text-muted">{note.summary}</p>}
                </div>
                {note.date && <span className="shrink-0 text-xs text-faint">{note.date}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
