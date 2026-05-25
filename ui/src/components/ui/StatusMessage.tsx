interface StatusMessageProps {
  error?: string;
  notice?: string;
  className?: string;
}

/**
 * Inline error / success banner used across settings and detail pages.
 * Renders nothing when both strings are empty.
 */
export function StatusMessage({ error, notice, className = "" }: StatusMessageProps) {
  if (!error && !notice) return null;
  return (
    <div className={className}>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}
    </div>
  );
}
