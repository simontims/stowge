import { useCallback, useState } from "react";
import { apiRequest } from "../lib/api";
import { useLatestRequest } from "./useLatestRequest";

interface UseResourceListOptions<T> {
  /** Load from this endpoint. Give either `url` or `fetcher`. */
  url?: string;
  /** Load with this function (an API helper such as listTags). */
  fetcher?: () => Promise<T[]>;
  onError?: string;
  /** Transform the raw API response before storing. */
  transform?: (data: unknown) => T[];
}

interface UseResourceListResult<T> {
  items: T[];
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
  /** True from the first render until the first load answers: the list is unknown, not empty. */
  loading: boolean;
  error: string;
  setError: React.Dispatch<React.SetStateAction<string>>;
  load: (options?: { background?: boolean }) => Promise<void>;
}

/**
 * Generic hook for loading a list of resources from an API endpoint.
 * Handles loading/error state, background refresh and out-of-order answers (only the latest
 * request may change the list).
 */
export function useResourceList<T>(options: UseResourceListOptions<T>): UseResourceListResult<T> {
  const { url, fetcher, onError, transform } = options;
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true); // every user loads on mount: until that answers, the list is unknown, not empty
  const [error, setError] = useState("");
  const beginRequest = useLatestRequest();

  const load = useCallback(
    async (opts?: { background?: boolean }) => {
      const background = opts?.background ?? false;
      const isLatest = beginRequest();
      if (!background) {
        setLoading(true);
        setError("");
      }
      try {
        const data = fetcher ? await fetcher() : await apiRequest<T[]>(url ?? "");
        if (isLatest()) setItems(transform ? transform(data as unknown as unknown) : data);
      } catch (err) {
        if (isLatest()) {
          setItems([]);
          setError((err as Error).message || onError || "Failed to load.");
        }
      } finally {
        if (isLatest()) setLoading(false);
      }
    },
    [url, fetcher, onError, transform, beginRequest]
  );

  return { items, setItems, loading, error, setError, load };
}
