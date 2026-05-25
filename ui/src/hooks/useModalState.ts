import { useCallback, useState } from "react";

interface UseModalStateResult<T> {
  target: T | null;
  isOpen: boolean;
  open: (value: T) => void;
  close: () => void;
}

/**
 * Generic hook for managing a modal/confirm dialog with a target entity.
 */
export function useModalState<T = unknown>(): UseModalStateResult<T> {
  const [target, setTarget] = useState<T | null>(null);

  const open = useCallback((value: T) => setTarget(value), []);
  const close = useCallback(() => setTarget(null), []);

  return { target, isOpen: target !== null, open, close };
}
