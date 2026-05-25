import { useCallback, useState } from "react";
import { apiRequest } from "../lib/api";

interface UseResourceListOptions<T> {
  url: string;
  onError?: string;
  /** Transform the raw API response before storing. */
  transform?: (data: unknown) => T[];
}

interface UseResourceListResult<T> {
  items: T[];
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
  loading: boolean;
  error: string;
  setError: React.Dispatch<React.SetStateAction<string>>;
  load: (options?: { background?: boolean }) => Promise<void>;
}

/**
 * Generic hook for loading a list of resources from an API endpoint.
 * Handles loading/error state and background refresh.
 */
export function useResourceList<T>(options: UseResourceListOptions<T>): UseResourceListResult<T> {
  const { url, onError, transform } = options;
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (opts?: { background?: boolean }) => {
      const background = opts?.background ?? false;
      if (!background) {
        setLoading(true);
        setError("");
      }
      try {
        const data = await apiRequest<T[]>(url);
        setItems(transform ? transform(data as unknown as unknown) : data);
      } catch (err) {
        setItems([]);
        setError((err as Error).message || onError || "Failed to load.");
      } finally {
        if (!background) {
          setLoading(false);
        }
      }
    },
    [url, onError, transform]
  );

  return { items, setItems, loading, error, setError, load };
}
