// "Custom model…": any model id the agent's provider serves, not only the
// ones a catalog or profile lists. Picks are remembered in the account
// settings (`customModelModes`, shared with the Happy app's picker).
import { Button, Stack, Text, TextInput } from "@mantine/core";
import { modals } from "@mantine/modals";
import { X } from "lucide-react";
import { useState } from "react";
import type { Account } from "@/lib/sync/account";
import type { AgentKind } from "@/lib/sync/models";
import { forgetCustomModel, rememberCustomModel } from "@/lib/sync/profileEdit";
import { IconButton } from "@/ui/IconButton";
import classes from "./session.module.css";

/** Only Claude and Codex take an arbitrary model id on a message; Prime Agent
 * and OpenCode pick from what they advertise (`sendOptions`). */
export const allowsCustomModel = (kind: AgentKind) => kind === "claude" || kind === "codex";

const HINT: Record<string, string> = {
  claude: "e.g. claude-opus-5-5, or a gateway's own id like vendor/model. Add :high for an effort.",
  codex: "e.g. gpt-5.5-codex, or a custom provider's model. Add :high for an effort.",
};

function CustomModelForm({ account, kind, recent, onPick, close }: { account: Account; kind: AgentKind; recent: string[]; onPick: (id: string) => void; close: () => void }) {
  const [value, setValue] = useState("");
  const [list, setList] = useState(recent);
  const id = value.trim();
  const invalid = /\s/.test(id) ? "No spaces" : undefined;
  const pick = (m: string) => {
    onPick(m);
    close();
    if (!recent.includes(m)) void account.updateAccountSettings((s) => rememberCustomModel(s, m)).catch(() => undefined);
  };
  const forget = (m: string) => {
    setList((l) => l.filter((x) => x !== m));
    void account.updateAccountSettings((s) => forgetCustomModel(s, m)).catch(() => undefined);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (id && !invalid) pick(id);
      }}
    >
      <Stack gap="sm">
        <TextInput
          label="Model id"
          description={`${HINT[kind] ?? ""} Switches with your next message.`}
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          error={invalid}
          classNames={{ input: classes.modelInput }}
          autoComplete="off"
          spellCheck={false}
          data-autofocus
        />
        {list.length > 0 && (
          <div>
            <Text size="xs" c="dimmed" fw={600} mb={4}>
              Recent
            </Text>
            <div className={classes.recents}>
              {list.map((m) => (
                <span key={m} className={classes.recent}>
                  <button type="button" className={classes.recentPick} onClick={() => pick(m)}>
                    {m}
                  </button>
                  <IconButton size="sm" variant="gray" label={`Forget ${m}`} icon={<X size={12} />} onClick={() => forget(m)} />
                </span>
              ))}
            </div>
          </div>
        )}
        <div className={classes.formActions}>
          <Button variant="default" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!id || !!invalid}>
            Use model
          </Button>
        </div>
      </Stack>
    </form>
  );
}

export function openCustomModel(o: { account: Account; kind: AgentKind; recent: string[]; onPick: (id: string) => void }): void {
  const close = () => modals.close(mid);
  const mid = modals.open({ title: "Custom model", size: 440, children: <CustomModelForm {...o} close={close} /> });
}
