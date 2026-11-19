import type { ReactNode } from "react";
import { useStore } from "@/app/hooks";
import type { SessionItem } from "@/lib/sync/account";
import type { ChatStore } from "@/lib/sync/chatStore";
import { canSwitchProvider } from "@/lib/sync/spawn";
import { ContextMeter } from "./ContextMeter";
import type { SessionSwitch } from "./hooks";
import { ModelPicker } from "./ModelPicker";
import { PermissionPicker } from "./PermissionPicker";
import { ProviderPicker } from "./ProviderPicker";
import classes from "./session.module.css";

function Context({ store, model }: { store: ChatStore; model: string }) {
  const ctx = useStore(store.context);
  return ctx ? <ContextMeter usage={ctx} model={model} /> : null;
}

/** One row above the composer: controls (permission mode, provider, model)
 * on the left, status (`children`, e.g. the plan, then context) on the right. */
export function SessionToolbar({ session, sw, store, children }: { session: SessionItem; sw: SessionSwitch; store: ChatStore | null; children?: ReactNode }) {
  return (
    <div className={classes.toolbar}>
      <PermissionPicker sw={sw} />
      {canSwitchProvider(session) && <ProviderPicker session={session} sw={sw} />}
      <ModelPicker sw={sw} />
      <span className={classes.spacer} />
      {children}
      {store && sw.kind !== "opencode" && <Context store={store} model={sw.activeModel} />}
    </div>
  );
}
