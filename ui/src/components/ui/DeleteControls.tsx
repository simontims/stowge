import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { outlinedActionButtonClasses } from "./buttonStyles";

interface DeleteActionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  isDeleting?: boolean;
  label?: string;
  className?: string;
}

export function DeleteActionButton({
  onClick,
  disabled = false,
  isDeleting = false,
  label = "Delete",
  className = "",
}: DeleteActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isDeleting}
      className={[
        outlinedActionButtonClasses("danger-hover"),
        "gap-1 px-2.5 py-1.5",
        className,
      ].join(" ")}
    >
      <Trash2 size={13} />
      {isDeleting ? "Deleting..." : label}
    </button>
  );
}

interface DeleteConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  deleting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
}

export function DeleteConfirmDialog({
  open,
  title,
  message,
  deleting = false,
  onCancel,
  onConfirm,
  confirmLabel = "Delete",
}: DeleteConfirmDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-100">{title}</h3>
        <div className="text-sm text-neutral-300">{message}</div>
        <div className="pt-1 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className={`${outlinedActionButtonClasses("neutral")} gap-1 px-2.5 py-1.5`}
          >
            Cancel
          </button>
          <button
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onClick={onConfirm}
            disabled={deleting}
            className={`${outlinedActionButtonClasses("danger")} gap-1 px-2.5 py-1.5`}
          >
            <Trash2 size={14} />
            {deleting ? "Deleting..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
