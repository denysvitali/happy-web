import type { ReactNode } from "react";
import { useMemo } from "react";
import { useAccountSettings, useStore } from "@/app/hooks";
import type { SessionItem } from "@/lib/sync/account";
import type { ChatStore } from "@/lib/sync/chatStore";
import { contextWindowFor, findProfile, sessionProfileId } from "@/lib/sync/profiles";
import { canSwitchProvider } from "@/lib/sync/spawn";
import { ContextMeter } from "./ContextMeter";
import type { SessionSwitch } from "./hooks";
import { ModelPicker } from "./ModelPicker";
import { PermissionPicker } from "./PermissionPicker";
import { ProviderPicker } from "./ProviderPicker";
import { UsageMeter } from "./UsageMeter";
import classes from "./session.module.css";

function Context({ session, store, model }: { session: SessionItem; store: ChatStore; model: string }) {
  const ctx = useStore(store.context);
  const reported = useStore(store.windows);
  const profiles = useAccountSettings().data?.profiles;
  const profile = findProfile(profiles ?? [], sessionProfileId(session.meta));
  const hints = useMemo(() => ({ reported, profile: profile ? contextWindowFor(profile, model) : undefined }), [reported, profile, model]);
  return ctx ? <ContextMeter usage={ctx} model={model} hints={hints} /> : null;
}

function Model({ sw, store }: { sw: SessionSwitch; store: ChatStore }) {
  return <ModelPicker sw={sw} running={useStore(store.context)?.model} />;
}

/** One row above the composer: controls (permission mode, provider, model)
 * on the left, status (`children`, e.g. the plan, then context) on the right. */
export function SessionToolbar({ session, sw, store, children }: { session: SessionItem; sw: SessionSwitch; store: ChatStore | null; children?: ReactNode }) {
  return (
    <div className={classes.toolbar}>
      <PermissionPicker sw={sw} />
      {canSwitchProvider(session) && <ProviderPicker session={session} sw={sw} />}
      {store ? <Model sw={sw} store={store} /> : <ModelPicker sw={sw} />}
      <span className={classes.spacer} />
      {children}
      {store && sw.kind !== "opencode" && sw.kind !== "agy" && <Context session={session} store={store} model={sw.activeModel} />}
      <UsageMeter session={session} />
    </div>
  );
}
