import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { Link, Outlet, RouterProvider, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { TRPCClientError } from "@trpc/client";
import { PostHogProvider } from "@posthog/react";
import "./index.css";
import Landing from "./pages/Landing";
import { authClient } from "./lib/auth";
import { safeRedirect } from "./lib/redirect";
import { trpc } from "./lib/trpc";
import Loader from "./components/Loader";
import { NotFound, RouteError } from "./components/RouteStates";
import { clearReloadGuard, reloadOnce } from "./lib/chunkReload";

const PlayerPage = lazy(() => import("./player/PlayerPage"));
const DiffPage = import.meta.env.DEV ? lazy(() => import("./player/DiffPage")) : null;
const Changelog = lazy(() => import("./pages/Changelog"));
const Docs = lazy(() => import("./pages/Docs"));
const Login = lazy(() => import("./pages/Login"));
const Home = lazy(() => import("./pages/Home"));
const Course = lazy(() => import("./pages/Course"));
const Explore = lazy(() => import("./pages/Explore"));
const Account = lazy(() => import("./pages/Account"));
const Admin = lazy(() => import("./pages/Admin"));
const Review = lazy(() => import("./pages/Review"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const DevBlocks = import.meta.env.DEV ? lazy(() => import("./pages/DevBlocks")) : null;
const EditorLab = lazy(() => import("./pages/EditorLab"));
const TestPlayer = import.meta.env.DEV ? lazy(() => import("./pages/TestPlayer")) : null;

const posthogToken = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST;

if (import.meta.env.DEV && !posthogToken) {
  console.error("VITE_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_PUBLIC_POSTHOG_PROJECT_TOKEN is configured");
}
if (import.meta.env.DEV && !posthogHost) {
  console.error("VITE_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_PUBLIC_POSTHOG_HOST is configured");
}

function Root() {
  const app = (
    <Suspense fallback={<div className="grid min-h-screen place-items-center"><Loader label="Loading your quest" /></div>}>
      <Outlet />
    </Suspense>
  );

  return posthogToken && posthogHost ? (
    <PostHogProvider apiKey={posthogToken} options={{
      api_host: posthogHost,
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      logs: {
        serviceName: "learnquest-web",
        environment: import.meta.env.MODE,
      },
      loaded: (posthog) => {
        void authClient.getSession().then(({ data }) => {
          const user = data?.user;
          if (user) posthog.identify(user.id, { email: user.email, name: user.name });
        }, () => undefined);
      },
      debug: import.meta.env.DEV,
    }}>
      {app}
    </PostHogProvider>
  ) : app;
}

async function getSession() {
  let result: Awaited<ReturnType<typeof authClient.getSession>>;
  try {
    result = await authClient.getSession();
  } catch {
    throw new Error("Couldn't check your session. Check your connection and try again.");
  }
  const { data, error } = result;
  if (error && error.status !== 401 && error.status !== 403) throw new Error("Couldn't check your session. Check your connection and try again.");
  return data;
}

async function requireProfile(here: string) {
  if (!await getSession()) throw redirect({ to: "/login", search: { redirect: here } });
  return trpc.me.handle.profile.query();
}

async function guard({ location }: { location: { href: string } }) {
  const profile = await requireProfile(location.href);
  if (profile.onboardingRequired) throw redirect({ to: "/onboarding", search: { redirect: location.href } });
  return { profile };
}

const redirectSearch = (s: Record<string, unknown>): { redirect?: string } => ({ redirect: typeof s.redirect === "string" ? s.redirect : undefined });
const root = createRootRoute({ component: Root });
const r = { getParentRoute: () => root };
const indexRoute = createRoute({
  ...r,
  path: "/",
  beforeLoad: async () => {
    if (!await getSession()) return { signedIn: false };
    const profile = await trpc.me.handle.profile.query();
    if (profile.onboardingRequired) throw redirect({ to: "/onboarding" });
    return { signedIn: true };
  },
  component: Index,
});
const accountRoute = createRoute({ ...r, path: "/account", component: AccountRoute, beforeLoad: guard });
const adminRoute = createRoute({
  ...r,
  path: "/admin",
  gcTime: 0,
  loader: async ({ location }) => {
    try {
      return await trpc.admin.dashboard.query();
    } catch (error) {
      if (error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED") {
        throw redirect({ to: "/login", search: { redirect: location.href } });
      }
      throw error;
    }
  },
  component: AdminRoute,
  errorComponent: (props) => props.error instanceof TRPCClientError && props.error.data?.code === "FORBIDDEN"
    ? <div className="grid min-h-screen place-content-center gap-3 p-6"><h1>Admin access required</h1><Link to="/" className="underline">Back home</Link></div>
    : <RouteError {...props} />,
});
const onboardingRoute = createRoute({
  ...r,
  path: "/onboarding",
  validateSearch: redirectSearch,
  beforeLoad: async ({ location, search }) => {
    const profile = await requireProfile(location.href);
    if (!profile.onboardingRequired) throw redirect({ to: "/" });
    const target = safeRedirect(search.redirect);
    const path = new URL(target, window.location.origin).pathname;
    return { profile, next: path === "/onboarding" || path === "/login" ? "/" : target };
  },
  component: OnboardingRoute,
});

function Index() {
  return indexRoute.useRouteContext().signedIn ? <Home /> : <Landing />;
}

function AccountRoute() {
  const { profile } = accountRoute.useRouteContext();
  return <Account profile={profile} />;
}

function AdminRoute() {
  return <Admin dashboard={adminRoute.useLoaderData()} />;
}

function OnboardingRoute() {
  const { profile, next } = onboardingRoute.useRouteContext();
  return <Onboarding profile={profile} next={next} />;
}

const routeTree = root.addChildren([
  indexRoute,
  createRoute({ ...r, path: "/changelog", component: () => <Changelog /> }),
  createRoute({ ...r, path: "/docs", component: () => <Docs /> }),
  createRoute({
    ...r,
    path: "/login",
    component: () => <Login />,
    validateSearch: redirectSearch,
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
  createRoute({ ...r, path: "/review/$slug", component: () => <Review />, beforeLoad: guard }),
  createRoute({ ...r, path: "/courses/$slug", component: () => <Course />, beforeLoad: guard }),
  createRoute({ ...r, path: "/explore", component: () => <Explore />, beforeLoad: guard }),
  accountRoute,
  adminRoute,
  onboardingRoute,
  ...(DevBlocks ? [createRoute({ ...r, path: "/dev/blocks", component: () => <DevBlocks /> })] : []),
  ...(DiffPage ? [createRoute({ ...r, path: "/diff", component: () => <DiffPage /> })] : []),
  ...(TestPlayer ? [createRoute({ ...r, path: "/test/player", component: () => <TestPlayer /> })] : []),
  createRoute({
    ...r,
    path: "/editor",
    component: () => <EditorLab />,
    beforeLoad: guard,
    validateSearch: (s: Record<string, unknown>): { lesson?: string; course?: string } => ({
      lesson: typeof s.lesson === "string" && s.lesson !== "" ? s.lesson : undefined,
      course: typeof s.course === "string" && s.course !== "" ? s.course : undefined,
    }),
  }),
]);

const router = createRouter({ routeTree, defaultNotFoundComponent: NotFound, defaultErrorComponent: RouteError });

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
