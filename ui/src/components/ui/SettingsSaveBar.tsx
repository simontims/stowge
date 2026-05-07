import type { ReactNode } from "react";
import { Save, Trash2 } from "lucide-react";
import { outlinedActionButtonClasses } from "./buttonStyles";

interface SettingsSaveBarProps {
  isDirty: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  /** When provided, renders a Delete button on the left side of the bar. */
  onDelete?: () => void;
  deleteDisabled?: boolean;
  extraActions?: ReactNode;
}

export function SettingsSaveBar({
  isDirty,
  saving,
  onSave,
  onCancel,
  onDelete,
  deleteDisabled,
  extraActions,
}: SettingsSaveBarProps) {
  return (
    <div className={["flex items-center gap-2", onDelete ? "justify-between" : "justify-end"].join(" ")}>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteDisabled ?? saving}
          className={`${outlinedActionButtonClasses("danger-hover")} gap-1.5 px-3 py-1.5 text-sm font-medium`}
        >
          <Trash2 size={14} />
          Delete
        </button>
      )}
      <div className="flex items-center gap-2">
        {extraActions}
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className={`${outlinedActionButtonClasses("neutral")} gap-1.5 px-3 py-1.5 text-sm font-medium`}
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
              ? outlinedActionButtonClasses("positive")
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
