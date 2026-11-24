// One provider profile, as happy_flutter's profile editor: name, agents,
// environment, Codex model providers, models and context windows. Saving
// writes only this profile into the shared settings blob; fields the editor
// does not show (structured configs, startup script, …) are kept.
import { Button, Chip, PasswordInput, Select, Textarea, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ClipboardPaste, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { useAccountSettingsOf } from "@/app/hooks";
import type { Account } from "@/lib/sync/account";
import {
  builtInJson,
  CONTEXT_WINDOWS,
  draftFromProfile,
  draftFromTemplate,
  inferAgents,
  isBuiltInId,
  isSecretName,
  newProfileId,
  parseExports,
  profileJson,
  removeProfile,
  storedProfile,
  suggestName,
  upsertProfile,
  validateDraft,
  windowLabel,
  type ProfileDraft,
} from "@/lib/sync/profileEdit";
import { BUILT_IN_PROFILES, type ProviderProfile } from "@/lib/sync/profiles";
import { Callout } from "@/ui/Callout";
import { FormRow, FormSection } from "@/ui/FormSection";
import { IconButton } from "@/ui/IconButton";
import { ListSkeleton } from "@/ui/List";
import { openSheet, SheetBody, SheetFooter } from "@/ui/Sheet";
import classes from "./providers.module.css";

const within = { withinPortal: false } as const;

export const failed = (title: string) => (e: unknown) => notifications.show({ color: "red", title, message: e instanceof Error ? e.message : String(e) });
const BLANK = "";
const DEFAULT_WINDOW = "0";
const windowData = (current: number | undefined, defaultLabel: string) => [
  { value: DEFAULT_WINDOW, label: defaultLabel },
  ...(current && !(CONTEXT_WINDOWS as readonly number[]).includes(current) ? [{ value: String(current), label: windowLabel(current) }] : []),
  ...CONTEXT_WINDOWS.map((w) => ({ value: String(w), label: windowLabel(w) })),
];
const toWindow = (v: string | null) => (v && v !== DEFAULT_WINDOW ? Number(v) : undefined);

/** Fields set outside the env list (by the Happy app); they win over env. */
function structuredFields(p: ProviderProfile | undefined): string[] {
  if (!p) return [];
  const out: string[] = [];
  if (p.anthropic?.baseUrl) out.push("ANTHROPIC_BASE_URL");
  if (p.anthropic?.authToken) out.push("ANTHROPIC_AUTH_TOKEN");
  if (p.anthropic?.model) out.push("ANTHROPIC_MODEL");
  if (p.openai?.baseUrl) out.push("OPENAI_BASE_URL");
  if (p.openai?.model) out.push("OPENAI_MODEL");
  if (p.azure) out.push("Azure OpenAI");
  if (p.together) out.push("Together AI");
  if (p.tmux) out.push("tmux");
  return out;
}

function Editor({ account, id, profile, close }: { account: Account; id: string | undefined; profile: ProviderProfile | undefined; close: () => void }) {
  const uid = useId();
  const isNew = !id;
  const builtIn = id ? BUILT_IN_PROFILES.find((p) => p.id === id) : undefined;
  /** A stored row: for a built-in id, the user's customisation. */
  const stored = !!profile;
  const [d, setD] = useState<ProfileDraft>(() => draftFromProfile(profile ?? builtIn));
  const [template, setTemplate] = useState(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ProfileDraft>) => setD((x) => ({ ...x, ...patch }));
  const extra = structuredFields(profile);

  const applyTemplate = (v: string | null) => {
    const t = BUILT_IN_PROFILES.find((p) => p.id === v);
    setTemplate(v ?? BLANK);
    setD(t ? draftFromTemplate(t) : draftFromProfile(undefined));
    setErrors({});
  };

  const importPasted = () => {
    const env = parseExports(paste ?? "");
    if (env.length === 0) {
      setErrors((e) => ({ ...e, paste: "No KEY=value lines found" }));
      return;
    }
    setD((x) => {
      const byName = new Map(x.env.filter((e) => e.name.trim()).map((e) => [e.name.trim(), e.value]));
      for (const e of env) byName.set(e.name, e.value);
      return {
        ...x,
        name: x.name.trim() ? x.name : (suggestName(env) ?? x.name),
        ...(x.env.length === 0 ? inferAgents(env) : {}),
        env: [...byName].map(([name, value]) => ({ name, value })),
      };
    });
    setPaste(null);
    setErrors(({ paste: _, ...rest }) => rest);
  };

  const save = async () => {
    const errs = validateDraft(d);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    const now = Date.now();
    const pid = id ?? newProfileId(now);
    try {
      await account.updateAccountSettings((s) => upsertProfile(s, profileJson(d, storedProfile(s, pid) ?? (builtIn ? builtInJson(builtIn) : undefined), pid, now)));
      close();
    } catch (e) {
      failed("Couldn't save the profile")(e);
      setSaving(false);
    }
  };

  const reset = () => {
    if (!id) return;
    setSaving(true);
    account.updateAccountSettings((s) => removeProfile(s, id)).then(close, (e: unknown) => {
      failed("Couldn't reset the profile")(e);
      setSaving(false);
    });
  };

  const envRow = (i: number, patch: Partial<{ name: string; value: string }>) => set({ env: d.env.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const modelRow = (i: number, patch: Partial<ProfileDraft["models"][number]>) => set({ models: d.models.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const codexRow = (i: number, patch: Partial<ProfileDraft["codexProviders"][number]>) =>
    set({ codexProviders: d.codexProviders.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const agent = (k: "claude" | "codex" | "agy") => (on: boolean) => {
    set({ [k]: on });
    setErrors(({ agents: _, ...rest }) => rest);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <SheetBody>
        {isNew && (
          <FormSection>
            <FormRow label="Start from" labelFor={`${uid}-tpl`}>
              <Select
                id={`${uid}-tpl`}
                data={[{ value: BLANK, label: "Blank profile" }, ...BUILT_IN_PROFILES.map((p) => ({ value: p.id, label: p.name }))]}
                value={template}
                onChange={applyTemplate}
                allowDeselect={false}
                comboboxProps={within}
              />
            </FormRow>
          </FormSection>
        )}
        <FormSection>
          <FormRow label="Name" labelFor={`${uid}-name`}>
            <TextInput id={`${uid}-name`} value={d.name} onChange={(e) => set({ name: e.currentTarget.value })} error={errors.name} placeholder="My gateway" data-autofocus={isNew || undefined} />
          </FormRow>
          <FormRow label="Description" labelFor={`${uid}-desc`}>
            <TextInput id={`${uid}-desc`} value={d.description} onChange={(e) => set({ description: e.currentTarget.value })} placeholder="Optional" />
          </FormRow>
        </FormSection>

        <FormSection title="Agents" footer={errors.agents ?? "Which agents offer this profile."}>
          <FormRow layout="bare">
            <div className={classes.chips}>
              <Chip checked={d.claude} onChange={agent("claude")} size="sm">
                Claude
              </Chip>
              <Chip checked={d.codex} onChange={agent("codex")} size="sm">
                Codex
              </Chip>
              <Chip checked={d.agy} onChange={agent("agy")} size="sm">
                Antigravity
              </Chip>
            </div>
          </FormRow>
        </FormSection>

        <FormSection
          title="Environment variables"
          footer={
            <>
              Passed to the agent, e.g. ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL. <code>{"${VAR:-fallback}"}</code> is filled in by the daemon from its own
              environment, which keeps API keys off your account.
            </>
          }
        >
          {d.env.map((e, i) => (
            <FormRow key={i} layout="bare">
              <div className={classes.envRow}>
                <TextInput
                  aria-label={`Variable ${i + 1} name`}
                  placeholder="NAME"
                  value={e.name}
                  onChange={(ev) => envRow(i, { name: ev.currentTarget.value })}
                  error={errors[`env.${i}`]}
                  classNames={{ input: classes.mono }}
                  autoComplete="off"
                  spellCheck={false}
                />
                {isSecretName(e.name) ? (
                  <PasswordInput aria-label={`${e.name || "Variable"} value`} placeholder="value" value={e.value} onChange={(ev) => envRow(i, { value: ev.currentTarget.value })} classNames={{ input: classes.mono, innerInput: classes.mono }} autoComplete="off" />
                ) : (
                  <TextInput aria-label={`${e.name || "Variable"} value`} placeholder="value" value={e.value} onChange={(ev) => envRow(i, { value: ev.currentTarget.value })} classNames={{ input: classes.mono }} autoComplete="off" spellCheck={false} />
                )}
                <IconButton size="sm" variant="gray" label={`Remove ${e.name || "variable"}`} icon={<X size={14} />} onClick={() => set({ env: d.env.filter((_, j) => j !== i) })} />
              </div>
            </FormRow>
          ))}
          {paste !== null && (
            <FormRow layout="stacked" label="Paste exports" labelFor={`${uid}-paste`}>
              <Textarea
                id={`${uid}-paste`}
                classNames={{ input: classes.mono }}
                autosize
                minRows={4}
                maxRows={12}
                placeholder={"export ANTHROPIC_BASE_URL=...\nexport ANTHROPIC_AUTH_TOKEN=..."}
                value={paste}
                onChange={(e) => setPaste(e.currentTarget.value)}
                error={errors.paste}
                spellCheck={false}
                data-autofocus
              />
              <div className={classes.actions}>
                <Button size="compact-sm" variant="default" onClick={() => setPaste(null)}>
                  Cancel
                </Button>
                <Button size="compact-sm" onClick={importPasted}>
                  Import
                </Button>
              </div>
            </FormRow>
          )}
          <FormRow layout="bare">
            <div className={classes.addRow}>
              <Button variant="subtle" size="compact-sm" leftSection={<Plus size={14} />} onClick={() => set({ env: [...d.env, { name: "", value: "" }] })}>
                Add variable
              </Button>
              {paste === null && (
                <Button variant="subtle" size="compact-sm" leftSection={<ClipboardPaste size={14} />} onClick={() => setPaste("")}>
                  Paste exports…
                </Button>
              )}
            </div>
          </FormRow>
        </FormSection>

        {extra.length > 0 && (
          <Callout tone="info">
            This profile also sets {extra.join(", ")} outside these variables (from the Happy app). Those settings are kept and win over the variables above.
          </Callout>
        )}

        {d.codex && (
          <FormSection title="Codex providers" footer="model_providers entries for Codex-compatible gateways. The key stays in the environment variable named per provider.">
            <FormRow label="Default provider" labelFor={`${uid}-cmp`}>
              <TextInput id={`${uid}-cmp`} value={d.codexModelProvider} onChange={(e) => set({ codexModelProvider: e.currentTarget.value })} placeholder="The first one" classNames={{ input: classes.mono }} spellCheck={false} />
            </FormRow>
            {d.codexProviders.map((c, i) => (
              <FormRow key={i} layout="bare">
                <div className={classes.codexCard}>
                  <TextInput label="ID" value={c.id} onChange={(e) => codexRow(i, { id: e.currentTarget.value })} error={errors[`codex.${i}.id`]} placeholder="my-gateway" classNames={{ input: classes.mono }} spellCheck={false} />
                  <TextInput label="Name" value={c.name ?? ""} onChange={(e) => codexRow(i, { name: e.currentTarget.value })} placeholder="Optional" />
                  <TextInput className={classes.wide} label="Base URL" value={c.baseUrl} onChange={(e) => codexRow(i, { baseUrl: e.currentTarget.value })} error={errors[`codex.${i}.baseUrl`]} placeholder="https://gateway.example/v1" classNames={{ input: classes.mono }} spellCheck={false} />
                  <TextInput label="Key variable" value={c.envKey} onChange={(e) => codexRow(i, { envKey: e.currentTarget.value })} error={errors[`codex.${i}.envKey`]} classNames={{ input: classes.mono }} spellCheck={false} />
                  <Select
                    label="Wire API"
                    data={[
                      { value: "responses", label: "Responses" },
                      { value: "chat", label: "Chat Completions" },
                    ]}
                    value={c.wireApi === "chat" ? "chat" : "responses"}
                    onChange={(v) => v && codexRow(i, { wireApi: v })}
                    allowDeselect={false}
                    comboboxProps={within}
                  />
                  <div className={classes.wide}>
                    <Button variant="subtle" color="red" size="compact-sm" leftSection={<X size={14} />} onClick={() => set({ codexProviders: d.codexProviders.filter((_, j) => j !== i) })}>
                      Remove provider
                    </Button>
                  </div>
                </div>
              </FormRow>
            ))}
            <FormRow layout="bare">
              <div className={classes.addRow}>
                <Button
                  variant="subtle"
                  size="compact-sm"
                  leftSection={<Plus size={14} />}
                  onClick={() => set({ codexProviders: [...d.codexProviders, { id: "", baseUrl: "", envKey: "OPENAI_API_KEY", wireApi: "responses" }] })}
                >
                  Add provider
                </Button>
              </div>
            </FormRow>
          </FormSection>
        )}

        <FormSection title="Models" footer="Offered in the model pickers with this profile. A context window is passed to Claude Code for that model.">
          {d.models.map((m, i) => (
            <FormRow key={i} layout="bare">
              <div className={classes.modelRow}>
                <TextInput aria-label={`Model ${i + 1}`} placeholder="provider/model" value={m.model} onChange={(e) => modelRow(i, { model: e.currentTarget.value })} classNames={{ input: classes.mono }} autoComplete="off" spellCheck={false} />
                <Select aria-label={`Model ${i + 1} context window`} data={windowData(m.window, "Model default")} value={String(m.window ?? DEFAULT_WINDOW)} onChange={(v) => modelRow(i, { window: toWindow(v) })} allowDeselect={false} comboboxProps={within} />
                <IconButton size="sm" variant="gray" label={`Remove ${m.model || "model"}`} icon={<X size={14} />} onClick={() => set({ models: d.models.filter((_, j) => j !== i) })} />
              </div>
            </FormRow>
          ))}
          <FormRow layout="bare">
            <div className={classes.addRow}>
              <Button variant="subtle" size="compact-sm" leftSection={<Plus size={14} />} onClick={() => set({ models: [...d.models, { model: "" }] })}>
                Add model
              </Button>
            </div>
          </FormRow>
        </FormSection>

        <FormSection footer="For models without their own. 1M also requests Claude's extended window.">
          <FormRow label="Context window" labelFor={`${uid}-ctx`}>
            <Select id={`${uid}-ctx`} data={windowData(d.contextWindow, "Provider default")} value={String(d.contextWindow ?? DEFAULT_WINDOW)} onChange={(v) => set({ contextWindow: toWindow(v) })} allowDeselect={false} comboboxProps={within} />
          </FormRow>
        </FormSection>
      </SheetBody>
      <SheetFooter
        note={
          builtIn && stored ? (
            <Button variant="subtle" color="red" size="compact-sm" onClick={reset} disabled={saving}>
              Reset to built-in
            </Button>
          ) : undefined
        }
      >
        <Button variant="default" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Save
        </Button>
      </SheetFooter>
    </form>
  );
}

/** Waits for the settings: the draft starts from the stored profile. */
function EditorGate({ account, id, close }: { account: Account; id: string | undefined; close: () => void }) {
  const q = useAccountSettingsOf(account);
  if (q.isError) {
    return (
      <SheetBody>
        <Callout tone="warning">Your profiles couldn't be loaded, so they can't be edited right now.</Callout>
      </SheetBody>
    );
  }
  if (!q.isSuccess) {
    return (
      <SheetBody>
        <ListSkeleton rows={4} />
      </SheetBody>
    );
  }
  const profile = id ? q.data.profiles.find((p) => p.id === id) : undefined;
  return <Editor account={account} id={id} profile={profile} close={close} />;
}

/** `id` undefined: a new profile. A built-in id without a stored row
 * customises that built-in (saved under its id; Reset drops it again). */
export function openProfileEditor(account: Account, id: string | undefined): void {
  const builtIn = id && isBuiltInId(id);
  openSheet({
    title: id ? (builtIn ? "Customize provider" : "Edit provider") : "New provider",
    size: 600,
    children: (close) => <EditorGate account={account} id={id} close={close} />,
  });
}
