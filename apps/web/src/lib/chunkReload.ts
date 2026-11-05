const KEY = "lq.chunk-reload";
const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export const isChunkError = (e: unknown) => e instanceof Error && CHUNK_ERROR.test(e.message);

/** A deploy replaces the hashed chunks, so a stale tab fails to load them. Reload once to pick up the new build; never loop. */
export function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(KEY)) return false;
    sessionStorage.setItem(KEY, "1");
  } catch {
    return false; // storage unavailable: cannot guard against a loop, so show the error instead
  }
  location.reload();
  return true;
}

/** Called once the app has rendered, so the next stale-chunk failure may reload again. */
export function clearReloadGuard() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
