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
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-4">
        <h3 className="text-sm font-semibold text-neutral-100">{title}</h3>

        {step === "confirm" && (
          <>
            <p className="text-sm text-neutral-300">
              {confirmDescription || (
                <>
                  Permanently delete {entityKindLabel.toLowerCase()}{" "}
                  <span className="font-medium text-neutral-100">{entityName}</span>?{" "}
                  {itemCount > 0 ? (
                    <>
                      The{" "}
                      <span className="font-medium text-neutral-100">
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
                <label className="text-xs uppercase tracking-wide text-neutral-500">{moveToLabel}</label>
                <select
                  value={moveToId}
                  onChange={(event) => onMoveToIdChange(event.target.value)}
                  className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
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
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={confirmDisabled}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-500/70 text-red-300 bg-red-950/30 hover:text-red-200 hover:bg-red-900/30 text-sm"
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
                <div key={i} className="flex items-center gap-2 text-sm text-neutral-300">
                  {i === progressMessages.length - 1 ? (
                    <span className="w-4 h-4 rounded-full border-2 border-neutral-500 border-t-transparent animate-spin shrink-0" />
                  ) : (
                    <span className="w-4 h-4 rounded-full bg-emerald-600/80 shrink-0" />
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
                <div key={i} className="flex items-center gap-2 text-sm text-neutral-300">
                  <span className="w-4 h-4 rounded-full bg-emerald-600/80 shrink-0" />
                  {msg}
                </div>
              ))}
              <div className="pt-1 flex justify-end">
                <button
                  onClick={onDone}
                  className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-500 text-sm"
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
