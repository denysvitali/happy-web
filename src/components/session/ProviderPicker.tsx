import { Combobox, Loader, Stack, Text, useCombobox } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Check, ChevronDown, Server, Settings2 } from "lucide-react";
import { useState } from "react";
import { useAccount } from "@/app/auth";
import { useAccountSettings } from "@/app/hooks";
import { openProviders } from "@/components/account/open";
import type { SessionItem } from "@/lib/sync/account";
import {
  DEFAULT_PROVIDER_LABEL,
  displayEnvValue,
  findProfile,
  modelForProfile,
  needsDeviceKey,
  NO_PROFILE,
  profileEndpoint,
  profilesForAgent,
  providerLabel,
  providerSpawn,
  sessionProfileId,
  type ProviderProfile,
  type ProviderSpawn,
} from "@/lib/sync/profiles";
import { isKubernetesSession } from "@/lib/sync/spawn";
import { Callout } from "@/ui/Callout";
import type { SessionSwitch } from "./hooks";
import classes from "./session.module.css";

const MANAGE = "\u0000manage";

const MODEL_KNOB = /^(ANTHROPIC_(DEFAULT_(\w+_)?)?MODEL|ANTHROPIC_SMALL_FAST_MODEL|CLAUDE_CODE_SUBAGENT_MODEL|OPENAI_MODEL)$/;

function SwitchDetails({ session, target, provider }: { session: SessionItem; target: ProviderProfile | undefined; provider: ProviderSpawn }) {
  // Model knobs bound to the picked model are the "Model" row already.
  const knobs = Object.entries(provider.environmentVariables).filter(([n, v]) => MODEL_KNOB.test(n) && v === provider.model).length;
  const env = Object.entries(provider.environmentVariables)
    .filter(([n, v]) => !(MODEL_KNOB.test(n) && v === provider.model))
    .map(([name, value]) => ({ name, value }));
  const k8s = isKubernetesSession(session);
  return (
    <Stack gap="sm">
      <Text size="sm">
        The agent restarts on <b>{target?.name ?? "the account login"}</b>
        {k8s ? " (in its Pod when it can, else in a new Pod on the same workspace)" : ""} and continues this conversation from its transcript. A running turn is
        interrupted or finishes first.
      </Text>
      <dl className={classes.facts}>
        <div className={classes.factRow}>
          <dt>Endpoint</dt>
          <dd>{profileEndpoint(target) ?? "Account login"}</dd>
        </div>
        <div className={classes.factRow}>
          <dt>Model</dt>
          <dd>
            {provider.model === "default" ? "Provider default" : provider.model}
            {knobs > 1 && <span className={classes.dim}> · {knobs} model variables</span>}
          </dd>
        </div>
        {env.map((e) => (
          <div key={e.name} className={classes.factRow}>
            <dt className={classes.mono}>{e.name}</dt>
            <dd className={classes.mono}>{displayEnvValue(e)}</dd>
          </div>
        ))}
      </dl>
      {needsDeviceKey(target) && (
        <Callout tone="warning">This profile's API key stays on the phone that created it; the daemon must supply its own.</Callout>
      )}
    </Stack>
  );
}

/** "Provider" chip: the session's provider profile; picking another restarts
 * the agent on it after a confirmation. */
export function ProviderPicker({ session, sw }: { session: SessionItem; sw: SessionSwitch }) {
  const account = useAccount();
  const settings = useAccountSettings();
  const [switching, setSwitching] = useState<string | undefined>();
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const custom = settings.data?.profiles ?? [];
  const agent = session.meta.flavor || "claude";
  const list = profilesForAgent(custom, agent);
  const current = sessionProfileId(session.meta);
  const currentKey = current === NO_PROFILE ? NO_PROFILE : current;
  const label = providerLabel(current, custom);

  const choose = (id: string) => {
    combobox.closeDropdown();
    if (id === MANAGE) return openProviders(account);
    if (id === currentKey) return;
    const target = id === NO_PROFILE ? undefined : findProfile(custom, id);
    let provider: ProviderSpawn;
    try {
      const model = modelForProfile({ profile: target, agent, current: session.meta.model, favorites: settings.data?.favoriteModelsByProfile });
      provider = providerSpawn({ profile: target, agent, model, previousModel: session.meta.model });
    } catch (e) {
      notifications.show({ color: "red", title: "Can't switch provider", message: e instanceof Error ? e.message : String(e) });
      return;
    }
    const name = target?.name ?? DEFAULT_PROVIDER_LABEL;
    modals.openConfirmModal({
      title: `Switch to ${name}?`,
      children: <SwitchDetails session={session} target={target} provider={provider} />,
      labels: { confirm: "Restart on " + name, cancel: "Cancel" },
      onConfirm: () => void run(name, provider),
    });
  };

  const run = async (name: string, provider: ProviderSpawn) => {
    setSwitching(name);
    const id = notifications.show({ loading: true, autoClose: false, withCloseButton: false, title: `Switching to ${name}…`, message: "Restarting the agent; the conversation is kept." });
    try {
      await account.switchProvider(session, provider);
      sw.clearModel();
      notifications.update({ id, loading: false, autoClose: 3000, withCloseButton: true, color: "green", title: `Now on ${name}`, message: "The conversation continues with your next message." });
    } catch (e) {
      notifications.update({ id, loading: false, autoClose: false, withCloseButton: true, color: "red", title: "Couldn't switch provider", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSwitching(undefined);
    }
  };

  const option = (id: string, name: string, hint: string | undefined) => (
    <Combobox.Option key={id} value={id} active={id === currentKey}>
      <div className={classes.option}>
        {id === currentKey ? <Check size={14} className={classes.check} /> : <span className={classes.checkSlot} />}
        <div className={classes.optionText}>
          <span className={classes.optionLabel}>{name}</span>
          {hint && <span className={classes.optionHint}>{hint}</span>}
        </div>
      </div>
    </Combobox.Option>
  );

  return (
    <Combobox store={combobox} withinPortal position="top-start" width={300} shadow="md" radius="md" onOptionSubmit={choose}>
      <Combobox.Target targetType="button">
        <button
          type="button"
          className={classes.chip}
          data-open={combobox.dropdownOpened || undefined}
          data-pending={switching ? true : undefined}
          disabled={!!switching}
          onClick={() => combobox.toggleDropdown()}
          aria-label={switching ? `Provider: switching to ${switching}` : `Provider: ${label ?? "daemon routing"}`}
          title={label ? `Provider: ${label}` : "No app chose this session's provider; the daemon's routing applies"}
        >
          {switching ? <Loader size={12} color="currentColor" /> : <Server size={14} className={classes.chipIcon} />}
          {/* Phones show the glyph only: the model chip already names what runs. */}
          {(switching || label) && <span className={`${classes.chipLabel} ${classes.wideOnly}`}>{switching ? `Switching to ${switching}…` : label}</span>}
          <ChevronDown size={12} className={classes.chevron} />
        </button>
      </Combobox.Target>
      <Combobox.Dropdown p={0}>
        <Combobox.Options className={classes.options} aria-label="Providers">
          <Text size="xs" c="dimmed" fw={600} px="sm" pt={6} pb={2}>
            Provider · restarts the agent
          </Text>
          {option(NO_PROFILE, DEFAULT_PROVIDER_LABEL, "Account login, no profile")}
          {list.map((p) => option(p.id, p.name, profileEndpoint(p) ?? "Account login"))}
          {settings.isPending && (
            <Combobox.Empty>
              <Loader size="xs" />
            </Combobox.Empty>
          )}
          {settings.isError && (
            <Text size="xs" c="dimmed" px="sm" py={6}>
              Your own profiles couldn't be loaded; built-ins only.
            </Text>
          )}
          <Combobox.Option value={MANAGE} className={classes.footerOption}>
            <div className={classes.option}>
              <Settings2 size={14} className={classes.checkSlot} />
              <span className={classes.optionLabel}>Manage providers…</span>
            </div>
          </Combobox.Option>
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
