/** Custom DOM event fired whenever a request returns 401. App.tsx listens to
 *  this to null-out its token state and show the LoginPage. */
export const UNAUTHORIZED_EVENT = "stowge:unauthorized";

function setSseTokenCookie(token: string): void {
  const encoded = encodeURIComponent(token);
  document.cookie = `stowge_sse_token=${encoded}; Path=/api/events; Max-Age=604800; SameSite=Lax`;
}

function clearSseTokenCookie(): void {
  document.cookie = "stowge_sse_token=; Path=/api/events; Max-Age=0; SameSite=Lax";
}

export function getToken(): string | null {
  const token = localStorage.getItem("stowge_token");
  if (token) {
    setSseTokenCookie(token);
  }
  return token;
}

export function saveToken(token: string): void {
  localStorage.setItem("stowge_token", token);
  setSseTokenCookie(token);
}

/** Remove the token and fire UNAUTHORIZED_EVENT so the auth gate re-renders. */
export function removeToken(): void {
  localStorage.removeItem("stowge_token");
  clearSseTokenCookie();
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

/** Decode the stored JWT and return the `sub` (user id) claim. */
export function getCurrentUserId(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub.trim() ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Fetch wrapper that attaches Bearer auth and handles 401 globally. */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers((init.headers as HeadersInit | undefined) ?? {});
  const token = getToken();

  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, { ...init, headers });
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
    removeToken(); // fires UNAUTHORIZED_EVENT → App.tsx shows LoginPage
    const detail =
      typeof payload === "object" && payload && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : "Session expired. Please sign in again.";
    throw new Error(detail);
  }

  if (!res.ok) {
    const detail =
      typeof payload === "object" && payload && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : `HTTP ${res.status}`;
    throw new Error(detail);
  }

  return payload as T;
}
