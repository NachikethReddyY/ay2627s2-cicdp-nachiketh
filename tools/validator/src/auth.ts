import { WEB_ORIGIN, API_ORIGIN, VALIDATOR_EMAIL, VALIDATOR_NAME, VALIDATOR_PASSWORD } from "./services.ts";

export type Cookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
};

export type StorageState = { cookies: Cookie[]; origins: [] };

export type HttpResponse = { status: number; setCookies: string[]; body: string };
export type HttpPost = (url: string, body: unknown, headers: Record<string, string>) => Promise<HttpResponse>;

export function parseSetCookie(line: string, host: string, nowSeconds: number): Cookie | null {
  const [pair, ...attrs] = line.split(";").map((part) => part.trim());
  const eq = pair.indexOf("=");
  if (eq < 1) return null;
  const cookie: Cookie = {
    name: pair.slice(0, eq),
    value: pair.slice(eq + 1),
    domain: host,
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  };
  for (const attr of attrs) {
    const [rawKey, ...rest] = attr.split("=");
    const key = rawKey.toLowerCase();
    const value = rest.join("=");
    if (key === "path" && value) cookie.path = value;
    else if (key === "httponly") cookie.httpOnly = true;
    else if (key === "secure") cookie.secure = true;
    else if (key === "samesite") cookie.sameSite = value.toLowerCase() === "strict" ? "Strict" : value.toLowerCase() === "none" ? "None" : "Lax";
    else if (key === "max-age" && Number.isFinite(Number(value))) cookie.expires = nowSeconds + Number(value);
    else if (key === "expires" && cookie.expires === -1 && !Number.isNaN(Date.parse(value))) cookie.expires = Math.floor(Date.parse(value) / 1000);
  }
  return cookie;
}

export function cookiesFromResponse(setCookies: string[], host: string, nowSeconds: number): Cookie[] {
  const byName = new Map<string, Cookie>();
  for (const line of setCookies) {
    const cookie = parseSetCookie(line, host, nowSeconds);
    if (cookie) byName.set(cookie.name, cookie);
  }
  return [...byName.values()];
}

export function storageStateOf(cookies: Cookie[]): StorageState {
  return { cookies, origins: [] };
}

export function cookieHeader(cookies: Cookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

export function authHeaders(): Record<string, string> {
  return { "content-type": "application/json", origin: WEB_ORIGIN };
}

export const realPost: HttpPost = async (url, body, headers) => {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), redirect: "manual" });
  return { status: res.status, setCookies: res.headers.getSetCookie(), body: await res.text() };
};

export async function signInValidator(post: HttpPost, nowSeconds: number): Promise<Cookie[]> {
  const headers = authHeaders();
  const signUp = await post(`${API_ORIGIN}/api/auth/sign-up/email`, { email: VALIDATOR_EMAIL, password: VALIDATOR_PASSWORD, name: VALIDATOR_NAME }, headers);
  const accepted = signUp.status >= 200 && signUp.status < 300;
  const alreadyExists = signUp.status === 422 || signUp.status === 400 || signUp.status === 409;
  if (!accepted && !alreadyExists) throw new Error(`sign-up failed with ${signUp.status}: ${signUp.body.slice(0, 200)}`);
  const signIn = await post(`${API_ORIGIN}/api/auth/sign-in/email`, { email: VALIDATOR_EMAIL, password: VALIDATOR_PASSWORD }, headers);
  if (signIn.status < 200 || signIn.status >= 300) throw new Error(`sign-in failed with ${signIn.status}: ${signIn.body.slice(0, 200)}`);
  const cookies = cookiesFromResponse(signIn.setCookies, "localhost", nowSeconds);
  if (cookies.length === 0) throw new Error("sign-in returned no session cookie");
  return cookies;
}
