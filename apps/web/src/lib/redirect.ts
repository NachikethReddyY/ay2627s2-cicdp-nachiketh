export function safeRedirect(raw: string | null | undefined): string {
  if (!raw || raw[0] !== "/" || raw[1] === "/" || /[\\\u0000-\u001f]/.test(raw)) return "/";
  try {
    const u = new URL(raw, location.origin);
    if (u.origin !== location.origin || u.pathname.startsWith("//")) return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

export const loginUrl = (path: string) => `/login?redirect=${encodeURIComponent(path)}`;
