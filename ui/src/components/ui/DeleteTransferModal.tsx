import type { ReactNode } from "react";

interface MoveOption {
  id: string;
  name: string;
}

interface DeleteTransferModalProps {
  open: boolean;
  title: string;
  entityKindLabel: string;
  entityName: string;
  itemCount: number;
  itemLabelSingular?: string;
  itemLabelPlural?: string;
  moveToLabel: string;
  noneOptionLabel: string;
  moveOptions: MoveOption[];
  moveToId: string;
  onMoveToIdChange: (value: string) => void;
  step: "confirm" | "progress" | "done";
  progressMessages: string[];
  onCancel: () => void;
  onConfirm: () => void;
  onDone: () => void;
  confirmButtonLabel?: string;
  confirmDescription?: ReactNode;
  showMoveSelector?: boolean;
  confirmDisabled?: boolean;
  progressContent?: ReactNode;
  doneContent?: ReactNode;
}

export function DeleteTransferModal({
  open,
  title,
  entityKindLabel,
  entityName,
  itemCount,
  itemLabelSingular = "item",
  itemLabelPlural = "items",
  moveToLabel,
  noneOptionLabel,
  moveOptions,
  moveToId,
  onMoveToIdChange,
  step,
  progressMessages,
  onCancel,
  onConfirm,
  onDone,
  confirmButtonLabel = "Delete",
  confirmDescription,
  showMoveSelector = true,
  confirmDisabled = false,
  progressContent,
  doneContent,
}: DeleteTransferModalProps) {
  if (!open) return null;

  const itemLabel = itemCount === 1 ? itemLabelSingular : itemLabelPlural;

  return (
    <div className="fixed inset-0 z-[70] bg-scrim/70 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl border border-border bg-surface shadow-2xl p-4 space-y-4">
        <h3 className="text-sm font-semibold text-heading">{title}</h3>

        {step === "confirm" && (
          <>
            <p className="text-sm text-secondary">
              {confirmDescription || (
                <>
                  Permanently delete {entityKindLabel.toLowerCase()}{" "}
                  <span className="font-medium text-heading">{entityName}</span>?{" "}
                  {itemCount > 0 ? (
                    <>
                      The{" "}
                      <span className="font-medium text-heading">
                        {itemCount} {itemLabel}
                      </span>{" "}
                      in this {entityKindLabel.toLowerCase()} will be moved to:
                    </>
                  ) : (
                    <>This {entityKindLabel.toLowerCase()} has no items. It will be permanently removed.</>
                  )}
                </>
              )}
            </p>

            {showMoveSelector && itemCount > 0 && (
              <div>
                <label className="text-xs uppercase tracking-wide text-subtle">{moveToLabel}</label>
                <select
                  value={moveToId}
                  onChange={(event) => onMoveToIdChange(event.target.value)}
                  className="mt-1 w-full bg-canvas border border-border-strong rounded-md px-3 py-2 text-sm text-body outline-none focus:border-border-focus"
                >
                  <option value="">{noneOptionLabel}</option>
                  {moveOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                onClick={onCancel}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border-strong text-secondary hover:text-heading hover:border-border-hover text-sm"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={confirmDisabled}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-danger-500/70 text-danger-300 bg-danger-950/30 hover:text-danger-200 hover:bg-danger-900/30 text-sm"
              >
                {confirmButtonLabel}
              </button>
            </div>
          </>
        )}

        {step === "progress" && (
          progressContent || (
            <div className="space-y-3">
              {progressMessages.map((msg, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-secondary">
                  {i === progressMessages.length - 1 ? (
                    <span className="w-4 h-4 rounded-full border-2 border-border-focus border-t-transparent animate-spin shrink-0" />
                  ) : (
                    <span className="w-4 h-4 rounded-full bg-success-600/80 shrink-0" />
                  )}
                  {msg}
                </div>
              ))}
            </div>
          )
        )}

        {step === "done" && (
          doneContent || (
            <div className="space-y-3">
              {progressMessages.map((msg, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-secondary">
                  <span className="w-4 h-4 rounded-full bg-success-600/80 shrink-0" />
                  {msg}
                </div>
              ))}
              <div className="pt-1 flex justify-end">
                <button
                  onClick={onDone}
                  className="inline-flex items-center px-3 py-1.5 rounded-md border border-border-strong text-secondary hover:text-heading hover:border-border-focus text-sm"
                >
                  OK
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
