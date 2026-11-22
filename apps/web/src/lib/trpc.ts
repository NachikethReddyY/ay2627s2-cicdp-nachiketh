import { createTRPCClient, httpBatchLink, httpLink, TRPCClientError } from "@trpc/client";
import { loginUrl } from "./redirect";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@learnquest/api/router";

let leaving = false;
function toLogin() {
  if (leaving || location.pathname === "/login") return;
  leaving = true;
  location.assign(loginUrl(location.pathname + location.search));
}

const sessionFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await fetch(input, { ...init, credentials: "include" });
  if (res.status === 401) toLogin();
  return res;
};

export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc", fetch: sessionFetch })],
});

export const trpcUnbatched = createTRPCClient<AppRouter>({
  links: [httpLink({ url: "/api/trpc", fetch: sessionFetch })],
});

export type RouterOutputs = inferRouterOutputs<AppRouter>;

export const isNotFound = (e: unknown) => e instanceof TRPCClientError && e.data?.code === "NOT_FOUND";
