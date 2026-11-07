import { Sparkles } from "lucide-react";

interface WelcomeModalProps {
  onTakeTour: () => void;
  onClose: () => void;
}

/** First-login interrupt: a few lines about Stowge, then take the tour or get on with it. */
export function WelcomeModal({ onTakeTour, onClose }: WelcomeModalProps) {
  return (
    <div className="fixed inset-0 z-[1900] flex items-center justify-center bg-black/70 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-heading"
        className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-emerald-400" />
          <h2 id="welcome-heading" className="text-base font-semibold text-neutral-100">
            Welcome to Stowge
          </h2>
        </div>
        <div className="mt-3 space-y-2 text-sm leading-6 text-neutral-400">
          <p>Stowge keeps track of what you own and where it lives.</p>
          <p>Add items with a photo and let AI suggest the details, tag them so an item can sit in several groups, and find them again with search and pinned filters.</p>
          <p>The tour takes about a minute. You can replay it any time from your user menu.</p>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-neutral-600 hover:text-neutral-100"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onTakeTour}
            className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Take the tour
          </button>
        </div>
      </div>
    </div>
  );
}
