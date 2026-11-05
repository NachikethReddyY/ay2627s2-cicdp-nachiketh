import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import { loginUrl } from "./redirect";
import type { inferRouterOutputs } from "@trpc/server";
// Type-only: no server code reaches the bundle.
import type { AppRouter } from "@learnquest/api/router";

let leaving = false;
// The session ended (expired or revoked): sign in again and come back to this page.
function toLogin() {
  if (leaving || location.pathname === "/login") return;
  leaving = true;
  location.assign(loginUrl(location.pathname + location.search));
}

// Same-origin; /api is proxied to the API in dev and preview.
export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      fetch: async (input, init) => {
        const res = await fetch(input, { ...init, credentials: "include" });
        if (res.status === 401) toLogin();
        return res;
      },
    }),
  ],
});

export type RouterOutputs = inferRouterOutputs<AppRouter>;

export const isNotFound = (e: unknown) => e instanceof TRPCClientError && e.data?.code === "NOT_FOUND";
export const trpcCode = (e: unknown) => (e instanceof TRPCClientError ? (e.data?.code as string | undefined) : undefined);
