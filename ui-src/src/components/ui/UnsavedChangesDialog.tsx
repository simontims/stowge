import { Save } from "lucide-react";

interface UnsavedChangesDialogProps {
  open: boolean;
  message: string;
  saving: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

export function UnsavedChangesDialog({
  open,
  message,
  saving,
  onCancel,
  onDiscard,
  onSave,
}: UnsavedChangesDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-3"
      >
        <h3 className="text-sm font-semibold text-neutral-100">Unsaved Changes</h3>
        <p className="text-sm text-neutral-300">{message}</p>
        <div className="pt-1 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
          >
            Cancel
          </button>
          <button
            onClick={onDiscard}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-500/70 text-red-300 bg-red-950/30 hover:text-red-200 hover:bg-red-900/30"
          >
            Discard
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-500/70 bg-emerald-950/30 text-emerald-300 hover:text-emerald-200 disabled:opacity-60"
          >
            <Save size={14} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
