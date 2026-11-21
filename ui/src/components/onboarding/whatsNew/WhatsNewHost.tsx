import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { apiRequest } from "../../../lib/api";
import type { CurrentUser } from "../../../lib/types";
import { buildDigest, digestHeading, type WhatsNewTour } from "../../../lib/whatsNew";
import { WHATS_NEW_TOURS } from "./registry";

interface WhatsNewHostProps {
  user: CurrentUser;
  onUserChange: (user: CurrentUser) => void;
  /** True while the welcome flow is on screen: never show two things at once. */
  suppress?: boolean;
  tours?: Readonly<Record<string, WhatsNewTour>>;
}

/** The "what changed since you were last here" card, shown once at login when something that
 *  changes existing behaviour is unseen. One card however many were missed: each entry has a
 *  one-line summary and an optional tour on request, so nobody has to watch them all. Smaller
 *  changes only light the dot on the user menu and are listed in the release notes. */
export function WhatsNewHost({ user, onUserChange, suppress = false, tours = WHATS_NEW_TOURS }: WhatsNewHostProps) {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(false);
  const [tourId, setTourId] = useState<string | null>(null);
  const unseen = user.whats_new?.unseen;
  const digest = useMemo(() => buildDigest(unseen ?? []), [unseen]);

  const markSeen = useCallback(async () => {
    // Hide first so a slow or failed request can't trap the user behind the card.
    setHidden(true);
    try {
      onUserChange(await apiRequest<CurrentUser>("/api/me/whats-new/seen", { method: "POST" }));
    } catch {
      // Best effort: the card shows again next session if this failed.
    }
  }, [onUserChange]);

  if (suppress || hidden || digest.interrupts.length === 0) return null;

  const ActiveTour = tourId ? tours[tourId] : undefined;
  if (ActiveTour) return <ActiveTour onDone={() => setTourId(null)} />;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-scrim/70 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-heading"
        className="w-full max-w-lg rounded-xl border border-border bg-surface p-5 shadow-2xl"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-success-400" />
          <h2 id="whats-new-heading" className="text-sm font-semibold text-heading">
            What&apos;s new
          </h2>
        </div>

        <p className="mt-1 text-sm text-muted">{digestHeading(digest)}</p>

        <ul className="mt-4 divide-y divide-border border-y border-border">
          {digest.interrupts.map((note) => (
            <li key={note.id} className="py-3">
              <p className="text-sm font-medium text-heading">{note.title}</p>
              {note.summary && <p className="mt-0.5 text-sm text-muted">{note.summary}</p>}
              {tours[note.id] && (
                <button
                  type="button"
                  onClick={() => setTourId(note.id)}
                  className="mt-2 text-xs font-medium text-success-400 hover:text-success-300"
                >
                  Show me
                </button>
              )}
            </li>
          ))}
        </ul>

        {digest.smaller.length > 0 && (
          <p className="mt-3 text-xs text-subtle">
            Plus {digest.smaller.length} smaller {digest.smaller.length === 1 ? "change" : "changes"} in the release notes.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              // The page marks everything seen once it has loaded, so its "New" badges still show.
              setHidden(true);
              navigate("/release-notes");
            }}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm text-secondary transition-colors hover:border-border-hover hover:text-heading"
          >
            View release notes
          </button>
          <button
            type="button"
            onClick={() => void markSeen()}
            className="rounded-md bg-success-600 px-4 py-1.5 text-sm font-medium text-on-solid transition-colors hover:bg-success-500"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
