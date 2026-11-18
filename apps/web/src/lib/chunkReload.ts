const KEY = "lq.chunk-reload";
const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export const isChunkError = (e: unknown) => e instanceof Error && CHUNK_ERROR.test(e.message);

export function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(KEY)) return false;
    sessionStorage.setItem(KEY, "1");
  } catch {
    return false;
  }
  location.reload();
  return true;
}

export function clearReloadGuard() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
  }
}
