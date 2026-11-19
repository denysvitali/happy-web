import { useStore } from "@/app/hooks";
import type { ChatStore } from "@/lib/sync/chatStore";
import { ContextMeter } from "./ContextMeter";
import type { SessionSwitch } from "./hooks";
import { ModelPicker } from "./ModelPicker";
import { PermissionPicker } from "./PermissionPicker";
import classes from "./session.module.css";

function Context({ store, model }: { store: ChatStore; model: string }) {
  const ctx = useStore(store.context);
  return ctx ? <ContextMeter usage={ctx} model={model} /> : null;
}

/** Slim bar above the composer: permission mode, model, context meter. */
export function SessionToolbar({ sw, store }: { sw: SessionSwitch; store: ChatStore | null }) {
  return (
    <div className={classes.toolbar}>
      <PermissionPicker sw={sw} />
      <ModelPicker sw={sw} />
      {sw.pending && <span className={classes.notice}>Model will switch with your next message</span>}
      <span className={classes.spacer} />
      {store && sw.kind !== "opencode" && <Context store={store} model={sw.activeModel} />}
    </div>
  );
}
