// Mirrors parseDir in apps/api/src/sandbox/files.ts, which decides which `dir` values GET /api/sandbox/files
// accepts: up to 4 segments of [A-Za-z0-9._-]{1,64}, never "." or "..". Keep the two in sync.
const SEGMENT = /^[A-Za-z0-9._-]{1,64}$/;

/** True when the API would accept the folder `parent/name` as a listing path, so it is worth showing an expand arrow. */
export function canExpand(parent: string, name: string): boolean {
  const parts = (parent ? parent.split("/") : []).concat(name);
  return parts.length <= 4 && parts.every((p) => SEGMENT.test(p) && p !== "." && p !== "..");
}
