import { createHashHistory, createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet } from "@tanstack/react-router";
import { useAuth } from "@/app/auth";
import { HomeScreen } from "@/routes/home";
import { LinkScreen } from "@/routes/link";

function Gate() {
  const { state } = useAuth();
  if (state.status === "loading") return <div className="text-muted-foreground p-6 text-sm">Loading…</div>;
  if (state.status === "unlinked") return <LinkScreen note={state.note} />;
  return <Outlet />;
}

const rootRoute = createRootRoute({ component: Outlet });
const authed = createRoute({ getParentRoute: () => rootRoute, id: "authed", component: Gate });
const home = createRoute({ getParentRoute: () => authed, path: "/", component: HomeScreen });
const chat = createRoute({
  getParentRoute: () => authed,
  path: "/s/$sessionId",
  component: lazyRouteComponent(() => import("@/routes/chat"), "ChatScreen"),
});
const demo = createRoute({
  getParentRoute: () => rootRoute,
  path: "/components-demo",
  component: lazyRouteComponent(() => import("@/routes/demo"), "DemoScreen"),
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([authed.addChildren([home, chat]), demo]),
  history: createHashHistory(),
  defaultPreload: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
