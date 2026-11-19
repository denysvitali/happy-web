import { createHashHistory, createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet } from "@tanstack/react-router";
import { useAuth } from "@/app/auth";
import { BrandMark } from "@/components/brand";
import { Shell } from "@/components/shell/Shell";
import shell from "@/components/shell/shell.module.css";
import { HomeScreen } from "@/routes/home";
import { LinkScreen } from "@/routes/link";
import { NotFoundScreen } from "@/routes/not-found";

function Gate() {
  const { state } = useAuth();
  if (state.status === "loading")
    return (
      <div className={shell.splash} aria-busy="true" aria-label="Loading">
        <BrandMark size={44} />
      </div>
    );
  if (state.status === "unlinked") return <LinkScreen note={state.note} />;
  return <Shell />;
}

const rootRoute = createRootRoute({ component: Outlet });
const authed = createRoute({ getParentRoute: () => rootRoute, id: "authed", component: Gate });
const home = createRoute({ getParentRoute: () => authed, path: "/", component: HomeScreen });
const chat = createRoute({
  getParentRoute: () => authed,
  path: "/s/$sessionId",
  component: lazyRouteComponent(() => import("@/routes/chat"), "ChatScreen"),
});
const agent = createRoute({
  getParentRoute: () => authed,
  path: "/s/$sessionId/agent/$toolId",
  component: lazyRouteComponent(() => import("@/routes/agent"), "AgentScreen"),
});
const inbox = createRoute({
  getParentRoute: () => authed,
  path: "/inbox",
  component: lazyRouteComponent(() => import("@/routes/inbox"), "InboxScreen"),
});
const inboxMessage = createRoute({
  getParentRoute: () => authed,
  path: "/inbox/$inboxSession/$inboxMessage",
  component: lazyRouteComponent(() => import("@/routes/inbox"), "InboxScreen"),
});
const demo = createRoute({
  getParentRoute: () => rootRoute,
  path: "/components-demo",
  component: lazyRouteComponent(() => import("@/routes/demo"), "DemoScreen"),
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([authed.addChildren([home, chat, agent, inbox, inboxMessage]), demo]),
  defaultNotFoundComponent: NotFoundScreen,
  history: createHashHistory(),
  defaultPreload: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
