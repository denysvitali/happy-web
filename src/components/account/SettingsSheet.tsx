import { SegmentedControl, Button, useMantineColorScheme } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Keyboard, LayoutGrid, Server } from "lucide-react";
import { useAccountSettingsOf, useNow } from "@/app/hooks";
import { useLink } from "@/components/shell/connection";
import { getServerUrl } from "@/lib/config";
import {
  machinesKey,
  type Account,
  type MachineItem,
} from "@/lib/sync/account";
import { machineName } from "@/lib/sync/decode";
import { isMachineOnline } from "@/lib/sync/sessionList";
import { FormRow, FormSection } from "@/ui/FormSection";
import { ListRow } from "@/ui/List";
import { openSheet, SheetBody } from "@/ui/Sheet";
import { PresenceDot } from "@/ui/Status";
import { openMachine } from "./MachineSheet";
import { openProviders } from "./open";
import classes from "./settings.module.css";

/** The sheet renders under ModalsProvider, outside the auth context: everything it needs comes in here. */
export interface SettingsContext {
  account: Account;
  /** Called after the sheet closed. */
  onDemo: () => void;
  onShortcuts: () => void;
  onForget: () => void;
}

const CONN = {
  online: "Connected",
  connecting: "Connecting…",
  offline: "Offline, reconnecting",
} as const;

/** Short build id: a commit hash is shortened; a dev/timestamp build is shown as is. */
function buildLabel(build: string, mode: string): string {
  const id = /^[0-9a-f]{40}$/.test(build) ? build.slice(0, 7) : build;
  return mode === "production" ? id : `${id} (${mode})`;
}

function Machines({ account, close }: { account: Account; close: () => void }) {
  const now = useNow();
  const q = useQuery<MachineItem[]>({
    queryKey: machinesKey,
    queryFn: ({ signal }) => account.fetchMachines(signal),
    staleTime: 60_000,
  });
  const list = q.data ?? [];
  const online = list.filter((m) => isMachineOnline(m, now)).length;
  return (
    <FormSection title={`Machines${q.isSuccess && list.length > 0 ? ` · ${online} of ${list.length} online` : ""}`}>
        {q.isSuccess && list.length === 0 && (
          <ListRow title="No machines linked yet" />
        )}
        {q.isError && <ListRow title="Couldn't load machines" />}
        {list.map((m) => {
          const up = isMachineOnline(m, now);
          return (
            <ListRow
              key={m.id}
              title={machineName(m.meta, m.id)}
              subtitle={[m.meta.host, m.meta.happyCliVersion && `v${m.meta.happyCliVersion}`].filter(Boolean).join(" · ")}
              trailing={
                <PresenceDot online={up} label={up ? "online" : "offline"} />
              }
              chevron
              onClick={() => {
                close();
                openMachine(account, m.id);
              }}
            />
          );
        })}
    </FormSection>
  );
}

function Providers({ account, close }: { account: Account; close: () => void }) {
  const q = useAccountSettingsOf(account);
  const n = q.data?.profiles.length;
  return (
    <FormSection title="Agents">
      <ListRow
        title="Providers"
        subtitle={q.isError ? "Couldn't load your profiles" : n ? `${n} profile${n === 1 ? "" : "s"} of your own` : "Built-ins, and your own gateways and keys"}
        leading={<Server size={16} />}
        chevron
        onClick={() => {
          close();
          openProviders(account);
        }}
      />
    </FormSection>
  );
}

function SettingsContent({
  ctx,
  close,
}: {
  ctx: SettingsContext;
  close: () => void;
}) {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const conn = useLink(ctx.account);
  const server = getServerUrl();
  const then = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <SheetBody>
      <FormSection title="Appearance">
        <FormRow layout="bare">
          <div className={classes.segment}>
            <SegmentedControl
              fullWidth
              aria-label="Appearance"
              value={colorScheme}
              onChange={(v) => setColorScheme(v as "light" | "dark" | "auto")}
              data={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "auto", label: "Auto" },
              ]}
            />
          </div>
        </FormRow>
      </FormSection>

      <FormSection title="Connection">
        <FormRow label="Server" trailing>
          <span className={classes.value} data-testid="settings-server">
            {server || "Not set"}
          </span>
        </FormRow>
        <FormRow label="Status" trailing>
          <span className={classes.value}>
            <PresenceDot online={conn === "online"} label={CONN[conn]} />{" "}
            {CONN[conn]}
          </span>
        </FormRow>
      </FormSection>

      <Machines account={ctx.account} close={close} />

      <Providers account={ctx.account} close={close} />

      <FormSection title="More">
          <ListRow
            title="Keyboard shortcuts"
            leading={<Keyboard size={16} />}
            chevron
            onClick={then(ctx.onShortcuts)}
          />
          <ListRow
            title="Components demo"
            leading={<LayoutGrid size={16} />}
            chevron
            onClick={then(ctx.onDemo)}
          />
      </FormSection>

      <FormSection title="About">
        <FormRow label="Build" trailing>
          <span className={classes.value}>
            {buildLabel(__HAPPY_BUILD__, import.meta.env.MODE)}
          </span>
        </FormRow>
      </FormSection>

      <FormSection footer="Deletes the stored account secret and token from this browser. You can link it again later.">
        <FormRow layout="bare">
          <Button
            className={classes.danger}
            color="red"
            variant="subtle"
            fullWidth
            onClick={then(ctx.onForget)}
          >
            Forget this device…
          </Button>
        </FormRow>
      </FormSection>
    </SheetBody>
  );
}

export function openSettings(ctx: SettingsContext): void {
  openSheet({
    title: "Settings",
    size: 480,
    children: (close) => <SettingsContent ctx={ctx} close={close} />,
  });
}
