import { Sparkles } from "lucide-react";

interface WelcomeModalProps {
  onTakeTour: () => void;
  onClose: () => void;
}

/** First-login interrupt: a few lines about Stowge, then take the tour or get on with it. */
export function WelcomeModal({ onTakeTour, onClose }: WelcomeModalProps) {
  return (
    <div className="fixed inset-0 z-[1900] flex items-center justify-center bg-scrim/70 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-heading"
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-success-400" />
          <h2 id="welcome-heading" className="text-base font-semibold text-heading">
            Welcome to Stowge
          </h2>
        </div>
        <div className="mt-3 space-y-2 text-sm leading-6 text-muted">
          <p>Stowge keeps track of what you own and where it lives.</p>
          <p>Add items with a photo and let AI suggest the details, tag them so an item can sit in several groups, and find them again with search and pinned filters.</p>
          <p>The tour takes about a minute. You can replay it any time from your user menu.</p>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm text-secondary transition-colors hover:border-border-hover hover:text-heading"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onTakeTour}
            className="rounded-md bg-success-600 px-4 py-1.5 text-sm font-medium text-on-solid transition-colors hover:bg-success-500"
          >
            Take the tour
          </button>
        </div>
      </div>
    </div>
  );
}
