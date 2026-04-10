/** Custom DOM event fired whenever a request returns 401. App.tsx listens to
 *  this to clear user state and show the LoginPage. */
export const UNAUTHORIZED_EVENT = "stowge:unauthorized";
export const OFFLINE_EVENT = "stowge:offline";

/** Shape of the current-user object returned by GET /api/me and POST /api/login. */
export interface CurrentUser {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
  role: string;
  theme: string;
  preferred_add_collection_id: string | null;
  preferred_add_location_id: string | null;
  last_open_collection: string | null;
  created_at: string | null;
  last_login_at: string | null;
}

function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) {
    return true;
  }
  if (!(err instanceof Error)) {
    return false;
  }

  const message = err.message.toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("load failed") ||
    message.includes("fetch")
  );
}

/** Fetch wrapper that uses HTTP-only session cookies (credentials: include) and
 *  handles 401 globally by dispatching UNAUTHORIZED_EVENT. */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers((init.headers as HeadersInit | undefined) ?? {});
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: "include" });
  } catch (err) {
    if (isNetworkFailure(err)) {
      window.dispatchEvent(new Event(OFFLINE_EVENT));
      throw new Error("Cannot reach the Stowge server right now. Check that it is running, then try again.");
    }
    throw err;
  }

  const text = await res.text();

  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (res.status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)); // → App.tsx shows LoginPage
    const detail =
      typeof payload === "object" && payload && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : "Session expired. Please sign in again.";
    throw new Error(detail);
  }

  if (!res.ok) {
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      window.dispatchEvent(new Event(OFFLINE_EVENT));
      throw new Error("Cannot reach the Stowge server right now. Check that it is running, then try again.");
    }

    const detail =
      typeof payload === "object" && payload && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : `HTTP ${res.status}`;
    throw new Error(detail);
  }

  return payload as T;
}
