import { useEffect } from "react";
import { SERVER_RETRY_DELAY_MS } from "./constants";

/**
 * Custom hook that automatically retries a function when an error occurs.
 * Useful for retrying server requests that fail due to connection issues.
 *
 * @param error - Error message (if empty/falsy, retry is paused)
 * @param loading - Loading state (if true, retry is paused)
 * @param onRetry - Callback to execute for retry (e.g., loadData({ background: true }))
 *
 * @example
 * const [error, setError] = useState("");
 * const [loading, setLoading] = useState(false);
 *
 * async function loadData(opts?: { background?: boolean }) {
 *   if (!opts?.background) setLoading(true);
 *   try {
 *     const data = await apiRequest("/api/data");
 *     setData(data);
 *   } catch (err) {
 *     setError((err as Error).message);
 *   } finally {
 *     if (!opts?.background) setLoading(false);
 *   }
 * }
 *
 * useServerRetry(error, loading, () => loadData({ background: true }));
 */
export function useServerRetry(
  error: string,
  loading: boolean,
  onRetry: () => void
): void {
  useEffect(() => {
    // Don't retry while loading or if there's no error
    if (loading || !error) {
      return;
    }

    const retryTimer = window.setTimeout(() => {
      onRetry();
    }, SERVER_RETRY_DELAY_MS);

    return () => window.clearTimeout(retryTimer);
  }, [error, loading, onRetry]);
}
