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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-heading"
        className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-emerald-400" />
          <h2 id="whats-new-heading" className="text-sm font-semibold text-neutral-100">
            What&apos;s new
          </h2>
        </div>

        <p className="mt-1 text-sm text-neutral-400">{digestHeading(digest)}</p>

        <ul className="mt-4 divide-y divide-neutral-800 border-y border-neutral-800">
          {digest.interrupts.map((note) => (
            <li key={note.id} className="py-3">
              <p className="text-sm font-medium text-neutral-100">{note.title}</p>
              {note.summary && <p className="mt-0.5 text-sm text-neutral-400">{note.summary}</p>}
              {tours[note.id] && (
                <button
                  type="button"
                  onClick={() => setTourId(note.id)}
                  className="mt-2 text-xs font-medium text-emerald-400 hover:text-emerald-300"
                >
                  Show me
                </button>
              )}
            </li>
          ))}
        </ul>

        {digest.smaller.length > 0 && (
          <p className="mt-3 text-xs text-neutral-500">
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
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-neutral-600 hover:text-neutral-100"
          >
            View release notes
          </button>
          <button
            type="button"
            onClick={() => void markSeen()}
            className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
