import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { Outlet, RouterProvider, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import "./index.css";
import Landing from "./pages/Landing";
import { authClient } from "./lib/auth";
import Loader from "./components/Loader";
import { NotFound, RouteError } from "./components/RouteStates";
import { clearReloadGuard, reloadOnce } from "./lib/chunkReload";

const PlayerPage = lazy(() => import("./player/PlayerPage"));
const DiffPage = import.meta.env.DEV ? lazy(() => import("./player/DiffPage")) : null;
const Changelog = lazy(() => import("./pages/Changelog"));
const Login = lazy(() => import("./pages/Login"));
const Home = lazy(() => import("./pages/Home"));
const Course = lazy(() => import("./pages/Course"));
const Explore = lazy(() => import("./pages/Explore"));
const Account = lazy(() => import("./pages/Account"));
const DevBlocks = import.meta.env.DEV ? lazy(() => import("./pages/DevBlocks")) : null;
const TestEditor = import.meta.env.DEV ? lazy(() => import("./pages/TestEditor")) : null;

function Root() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center"><Loader label="Loading your quest" /></div>}>
      <Outlet />
    </Suspense>
  );
}

// Sends signed-out visitors to /login (and back here afterwards) before the route renders.
// A failed check is not "signed out": it throws, so the route's error screen offers a retry.
async function requireSession(here: string) {
  let result: Awaited<ReturnType<typeof authClient.getSession>>;
  try {
    result = await authClient.getSession();
  } catch {
    throw new Error("Couldn't check your session. Check your connection and try again.");
  }
  const { data, error } = result;
  if (error && error.status !== 401 && error.status !== 403) throw new Error("Couldn't check your session. Check your connection and try again.");
  if (!data) throw redirect({ to: "/login", search: { redirect: here } });
}
const guard = ({ location }: { location: { href: string } }) => requireSession(location.href);

function Index(): React.ReactElement | null {
  const { data, isPending } = authClient.useSession();
  return isPending ? null : data ? <Home /> : <Landing />;
}

const root = createRootRoute({ component: Root });
const r = { getParentRoute: () => root };
const routeTree = root.addChildren([
  createRoute({ ...r, path: "/", component: Index }),
  createRoute({ ...r, path: "/changelog", component: () => <Changelog /> }),
  createRoute({
    ...r,
    path: "/login",
    component: () => <Login />,
    validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({ redirect: typeof s.redirect === "string" ? s.redirect : undefined }),
  }),
  createRoute({
    ...r,
    path: "/play",
    component: () => <PlayerPage />,
    beforeLoad: guard,
    validateSearch: (s: Record<string, unknown>): { lesson?: string; course?: string } => ({
      lesson: typeof s.lesson === "string" ? s.lesson : undefined,
      course: typeof s.course === "string" ? s.course : undefined,
    }),
  }),
  createRoute({ ...r, path: "/courses/$slug", component: () => <Course />, beforeLoad: guard }),
  createRoute({ ...r, path: "/explore", component: () => <Explore />, beforeLoad: guard }),
  createRoute({ ...r, path: "/account", component: () => <Account />, beforeLoad: guard }),
  ...(DevBlocks ? [createRoute({ ...r, path: "/dev/blocks", component: () => <DevBlocks /> })] : []),
  ...(DiffPage ? [createRoute({ ...r, path: "/diff", component: () => <DiffPage /> })] : []),
  ...(TestEditor ? [createRoute({ ...r, path: "/test/editor", component: () => <TestEditor /> })] : []),
]);

const router = createRouter({ routeTree, defaultNotFoundComponent: NotFound, defaultErrorComponent: RouteError });

// Vite reports a failed chunk preload (a deploy replaced the files under a stale tab): reload once.
window.addEventListener("vite:preloadError", (e) => {
  if (reloadOnce()) e.preventDefault();
});
window.addEventListener("load", () => setTimeout(clearReloadGuard, 10_000));
declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
