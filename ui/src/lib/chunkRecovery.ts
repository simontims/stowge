const RELOAD_STAMP = "stowge:chunk-reload-at";
/** At most one automatic reload per this many milliseconds, so a permanently broken build cannot loop. */
export const RELOAD_WINDOW_MS = 60_000;

/** After a redeploy, an open tab asks for chunk files that no longer exist. Reload to pick up the
 *  new build, but no more than once per minute. If the error comes back inside that window the
 *  error boundary shows its Reload button instead. Storage can be unavailable (private modes):
 *  then no automatic reload happens and the boundary is the fallback. */
export function installChunkRecovery(): () => void {
  const handler = (event: Event) => {
    event.preventDefault();
    try {
      const last = Number(sessionStorage.getItem(RELOAD_STAMP) || 0);
      if (Date.now() - last < RELOAD_WINDOW_MS) return;
      sessionStorage.setItem(RELOAD_STAMP, String(Date.now()));
    } catch {
      return;
    }
    window.location.reload();
  };
  window.addEventListener("vite:preloadError", handler);
  return () => window.removeEventListener("vite:preloadError", handler);
}
