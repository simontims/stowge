import { useEffect, useState } from "react";

interface NumericFieldOptions {
  min?: number;
  max?: number;
  fallback: number;
  integer?: boolean;
}

/**
 * Allows a numeric input to be freely edited (including clearing the field)
 * without fighting the user. The parent form state stays typed as `number`.
 *
 * Usage:
 *   const qtyField = useNumericField(form.quantity, (v) => setForm(f => ({ ...f, quantity: v })), { min: 1, fallback: 1 });
 *   <input type="number" {...qtyField} />
 */
export function useNumericField(
  committedValue: number,
  onCommit: (value: number) => void,
  { min, max, fallback, integer = true }: NumericFieldOptions,
) {
  const [raw, setRaw] = useState(String(committedValue));

  // Sync raw display when external value changes (e.g. form reset)
  useEffect(() => {
    setRaw(String(committedValue));
  }, [committedValue]);

  function clamp(n: number): number {
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  }

  return {
    value: raw,
    onChange(e: React.ChangeEvent<HTMLInputElement>) {
      setRaw(e.target.value);
    },
    onBlur() {
      const parsed = integer
        ? parseInt(raw, 10)
        : parseFloat(raw);
      const resolved = Number.isFinite(parsed) ? clamp(parsed) : fallback;
      onCommit(resolved);
      setRaw(String(resolved));
    },
  };
}
