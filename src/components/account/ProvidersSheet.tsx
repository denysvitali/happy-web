// Provider profiles (Settings → Providers, or the session's provider chip):
// the user's own and customised built-ins first, then the untouched
// built-ins. Everything is the account settings blob shared with the Happy
// app (src/lib/sync/profileEdit.ts); lazy through ./open.ts.
import { Button, Menu } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Copy, Ellipsis, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useAccountSettingsOf } from "@/app/hooks";
import type { Account } from "@/lib/sync/account";
import { builtInJson, duplicateProfile, isBuiltInId, removeProfile, storedProfile, upsertProfile, type Json } from "@/lib/sync/profileEdit";
import { BUILT_IN_PROFILES, profileEndpoint, type ProviderProfile } from "@/lib/sync/profiles";
import { Callout } from "@/ui/Callout";
import { FormRow, FormSection } from "@/ui/FormSection";
import { IconButton } from "@/ui/IconButton";
import { ListRow, ListSkeleton } from "@/ui/List";
import { openSheet, SheetBody } from "@/ui/Sheet";
import { showUndo } from "@/ui/undoToast";
import { failed, openProfileEditor } from "./ProfileEditor";

const AGENTS: [keyof ProviderProfile["compatibility"], string][] = [
  ["claude", "Claude"],
  ["codex", "Codex"],
  ["agy", "Antigravity"],
];

const agentsLabel = (p: ProviderProfile) =>
  AGENTS.filter(([k]) => p.compatibility[k])
    .map(([, l]) => l)
    .join(", ");

const subtitle = (p: ProviderProfile) => [profileEndpoint(p) ?? "Account login", agentsLabel(p)].filter(Boolean).join(" · ");

function RowMenu({ account, p, stored }: { account: Account; p: ProviderProfile; stored: boolean }) {
  const builtIn = isBuiltInId(p.id);
  const duplicate = () => {
    const def = BUILT_IN_PROFILES.find((b) => b.id === p.id);
    account
      .updateAccountSettings((s) => {
        const src = storedProfile(s, p.id) ?? (def ? builtInJson(def) : undefined);
        return src ? duplicateProfile(s, src, Date.now()) : s;
      })
      .then(() => notifications.show({ message: `Duplicated ${p.name}` }), failed("Couldn't duplicate the profile"));
  };
  const remove = () => {
    let removed: Json | undefined;
    account
      .updateAccountSettings((s) => {
        removed = storedProfile(s, p.id);
        return removeProfile(s, p.id);
      })
      .then(() => {
        const r = removed;
        if (r) showUndo(builtIn ? `${p.name} reset` : `Deleted ${p.name}`, () => void account.updateAccountSettings((s) => upsertProfile(s, r)).catch(failed("Couldn't restore the profile")));
      }, failed("Couldn't delete the profile"));
  };
  return (
    <Menu position="bottom-end" width={190} shadow="md" withinPortal={false}>
      <Menu.Target>
        <IconButton size="sm" label={`${p.name} actions`} icon={<Ellipsis size={16} strokeWidth={2} />} />
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<Pencil size={14} />} onClick={() => openProfileEditor(account, p.id)}>
          {stored || !builtIn ? "Edit" : "Customize"}
        </Menu.Item>
        <Menu.Item leftSection={<Copy size={14} />} onClick={duplicate}>
          Duplicate
        </Menu.Item>
        {stored &&
          (builtIn ? (
            <Menu.Item leftSection={<RotateCcw size={14} />} onClick={remove}>
              Reset to built-in
            </Menu.Item>
          ) : (
            <Menu.Item leftSection={<Trash2 size={14} />} color="red" onClick={remove}>
              Delete
            </Menu.Item>
          ))}
      </Menu.Dropdown>
    </Menu>
  );
}

function ProvidersContent({ account }: { account: Account }) {
  const q = useAccountSettingsOf(account);
  const mine = q.data?.profiles ?? [];
  const ids = new Set(mine.map((p) => p.id));
  const builtIns = BUILT_IN_PROFILES.filter((p) => !ids.has(p.id));
  const row = (p: ProviderProfile, stored: boolean) => (
    <ListRow
      key={p.id}
      title={p.name}
      subtitle={stored && isBuiltInId(p.id) ? `Customized · ${subtitle(p)}` : subtitle(p)}
      accessory={<RowMenu account={account} p={p} stored={stored} />}
      onClick={q.isSuccess ? () => openProfileEditor(account, p.id) : undefined}
    />
  );
  return (
    <SheetBody>
      {q.isError && <Callout tone="warning">Your profiles couldn't be loaded, so they can't be edited right now.</Callout>}
      <FormSection
        title="Your profiles"
        footer="Shared with the Happy app on every device. Values are stored in your end-to-end encrypted settings; write ${VAR:-} to have the daemon fill a key from its own environment instead."
      >
        {q.isPending && <ListSkeleton rows={2} />}
        {q.isSuccess && mine.length === 0 && <ListRow title="No profiles yet" subtitle="Start from a built-in or from scratch" dimmed />}
        {mine.map((p) => row(p, true))}
        <FormRow layout="bare">
          <Button variant="subtle" fullWidth leftSection={<Plus size={14} />} disabled={!q.isSuccess} onClick={() => openProfileEditor(account, undefined)}>
            New profile
          </Button>
        </FormRow>
      </FormSection>
      {q.isSuccess && builtIns.length > 0 && <FormSection title="Built-in">{builtIns.map((p) => row(p, false))}</FormSection>}
    </SheetBody>
  );
}

export function openProviders(account: Account): void {
  openSheet({ title: "Providers", size: 520, children: () => <ProvidersContent account={account} /> });
}
