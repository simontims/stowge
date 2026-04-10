import { Save, Trash2 } from "lucide-react";

interface SettingsSaveBarProps {
  isDirty: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  /** When provided, renders a Delete button on the left side of the bar. */
  onDelete?: () => void;
  deleteDisabled?: boolean;
}

export function SettingsSaveBar({
  isDirty,
  saving,
  onSave,
  onCancel,
  onDelete,
  deleteDisabled,
}: SettingsSaveBarProps) {
  return (
    <div className={["flex items-center gap-2", onDelete ? "justify-between" : "justify-end"].join(" ")}>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteDisabled ?? saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-400 hover:text-red-300 hover:border-red-500/70 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Trash2 size={14} />
          Delete
        </button>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty || saving}
          className={[
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed",
            isDirty
              ? "border-emerald-500/70 bg-emerald-950/30 text-emerald-300 hover:text-emerald-200"
              : "border-neutral-700 text-neutral-500",
          ].join(" ")}
        >
          <Save size={14} />
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
