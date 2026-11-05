/** A same-origin path from a `redirect` search param, or "/" for anything else (absolute URLs, `//host`, backslashes). */
export function safeRedirect(raw: string | null | undefined): string {
  if (!raw || raw[0] !== "/" || raw[1] === "/" || /[\\\u0000-\u001f]/.test(raw)) return "/";
  try {
    const u = new URL(raw, location.origin);
    // Dot segments can normalise "/a/..//evil" to "//evil", a protocol-relative URL, so check the result too.
    if (u.origin !== location.origin || u.pathname.startsWith("//")) return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

/** The login page URL that returns to `path` after sign-in. */
export const loginUrl = (path: string) => `/login?redirect=${encodeURIComponent(path)}`;
