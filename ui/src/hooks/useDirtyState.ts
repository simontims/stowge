import { useCallback, useEffect, useMemo, useState } from "react";
import { useBeforeUnload } from "../lib/useBeforeUnload";

interface UseDirtyStateOptions<F> {
  /** The current form state. */
  form: F;
  /** The initial/saved form state to compare against. */
  initialForm: F;
  /** Custom equality check. Defaults to JSON.stringify comparison. */
  isEqual?: (a: F, b: F) => boolean;
  /** Whether this component is embedded (disables beforeunload). */
  embedded?: boolean;
  /** Whether the form is currently active (e.g. editingId !== null). */
  active?: boolean;
  /** Callback when dirty state changes (for embedded components). */
  onDirtyChange?: (dirty: boolean) => void;
}

interface UseDirtyStateResult {
  isDirty: boolean;
  unsavedPromptOpen: boolean;
  /** Call when user tries to navigate away from dirty form. Returns true if navigation should proceed. */
  guardNavigation: () => boolean;
  /** Open the unsaved changes prompt. */
  openPrompt: () => void;
  /** Close the unsaved changes prompt (e.g. user clicks Cancel). */
  closePrompt: () => void;
  /** Discard changes and close prompt. Call your cancelEdit after this. */
  confirmDiscard: () => void;
}

/**
 * Hook that manages dirty state detection and unsaved-changes prompt logic.
 */
export function useDirtyState<F>(options: UseDirtyStateOptions<F>): UseDirtyStateResult {
  const { form, initialForm, isEqual, embedded, active = true, onDirtyChange } = options;
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);

  const isDirty = useMemo(() => {
    if (!active) return false;
    if (isEqual) return !isEqual(form, initialForm);
    return JSON.stringify(form) !== JSON.stringify(initialForm);
  }, [form, initialForm, isEqual, active]);

  useBeforeUnload(!embedded && active && isDirty);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const guardNavigation = useCallback((): boolean => {
    if (isDirty) {
      setUnsavedPromptOpen(true);
      return false;
    }
    return true;
  }, [isDirty]);

  const openPrompt = useCallback(() => setUnsavedPromptOpen(true), []);
  const closePrompt = useCallback(() => setUnsavedPromptOpen(false), []);
  const confirmDiscard = useCallback(() => setUnsavedPromptOpen(false), []);

  return { isDirty, unsavedPromptOpen, guardNavigation, openPrompt, closePrompt, confirmDiscard };
}
