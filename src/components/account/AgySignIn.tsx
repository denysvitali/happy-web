// Antigravity sign-in for a Kubernetes machine (src/lib/sync/agyAuth.ts): the
// daemon runs agy's own Google login, this shows its link and relays the code
// Google displays. One login is shared by every Antigravity session there.
import { Button, Group, Loader, Stack, Text, TextInput } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Account, MachineItem } from "@/lib/sync/account";
import { agyStatusLine, isFlowOver, type AgyAuthFlow, type AgyAuthState } from "@/lib/sync/agyAuth";
import { isUnsupported } from "@/lib/sync/machineUpdates";
import { Callout } from "@/ui/Callout";
import { FormSection } from "@/ui/FormSection";
import { ListRow } from "@/ui/List";

const POLL_MS = 2000;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const statusKey = (machineId: string) => ["agy-auth", machineId] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends the code, then follows an exchange that outlasts the call
 * ("completing") until it settles, within the daemon's 90 s Submit bound. */
async function completeSignIn(account: Account, machineId: string, flowId: string, code: string): Promise<AgyAuthState> {
  let s = await account.agyAuthComplete(machineId, flowId, code);
  for (let i = 0; i < 60 && !isFlowOver(s); i++) {
    await sleep(POLL_MS);
    s = await account.agyAuthStatus(machineId, flowId);
  }
  return s;
}

function SignInDialog({ account, machineId, close }: { account: Account; machineId: string; close: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [flow, setFlow] = useState<AgyAuthFlow>();
  const [error, setError] = useState<string>();
  // For the unmount cleanup only: the flow to cancel unless it finished.
  const pending = useRef<string | undefined>(undefined);

  const begin = useMutation({
    mutationFn: () => account.agyAuthBegin(machineId),
    onMutate: () => {
      setError(undefined);
      setFlow(undefined);
    },
    onSuccess: (f) => {
      pending.current = f.flowId;
      setFlow(f);
    },
    onError: (e) => setError(errText(e)),
  });
  const complete = useMutation({
    mutationFn: (flowId: string) => completeSignIn(account, machineId, flowId, code.trim()),
    onSettled: () => void qc.invalidateQueries({ queryKey: statusKey(machineId) }),
    onSuccess: (s) => {
      if (s.status === "authenticated") {
        pending.current = undefined;
        notifications.show({ color: "green", title: "Signed in to Antigravity", message: "New and restarted Antigravity sessions use this login." });
        close();
        return;
      }
      setError(s.error || (s.status === "not_found" ? "This sign-in expired; start again." : "Sign-in did not finish; start again."));
      setFlow(undefined);
    },
    onError: (e) => {
      setError(errText(e));
      setFlow(undefined);
    },
  });

  // A fresh flow per open; an unfinished one is cancelled on close.
  const { mutate: start } = begin;
  useEffect(() => {
    start();
    return () => {
      if (pending.current) void account.agyAuthCancel(machineId, pending.current).catch(() => {});
    };
  }, [account, machineId, start]);

  if (begin.isPending) {
    return (
      <Group gap="sm">
        <Loader size={16} />
        <Text size="sm">Starting Antigravity on the machine…</Text>
      </Group>
    );
  }
  if (!flow) {
    return (
      <Stack gap="md">
        <Callout tone="danger" title="Not signed in">
          {error ?? "The sign-in did not start."}
        </Callout>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={close}>
            Close
          </Button>
          <Button onClick={() => start()}>Start again</Button>
        </Group>
      </Stack>
    );
  }
  const busy = complete.isPending;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim() && !busy) complete.mutate(flow.flowId);
      }}
    >
      <Stack gap="md">
        <Text size="sm">1. Open Google's sign-in and allow Antigravity access.</Text>
        <Button component="a" href={flow.url} target="_blank" rel="noopener noreferrer" variant="light">
          Open Google sign-in
        </Button>
        <TextInput
          label="2. Paste the code Google shows"
          value={code}
          onChange={(e) => setCode(e.currentTarget.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!code.trim()}>
            Sign in
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function openSignIn(account: Account, machineId: string) {
  const modalId = `agy-sign-in-${machineId}`;
  modals.open({
    modalId,
    title: "Sign in to Antigravity",
    children: <SignInDialog account={account} machineId={machineId} close={() => modals.close(modalId)} />,
  });
}

/** Hidden on machines that cannot sign agy in (not Kubernetes, older daemons). */
export function AgySignIn({ account, machine, online }: { account: Account; machine: MachineItem; online: boolean }) {
  const q = useQuery({
    queryKey: statusKey(machine.id),
    queryFn: () => account.agyAuthStatus(machine.id),
    enabled: online,
    staleTime: 30_000,
    retry: (n, e) => !isUnsupported(e) && n < 1,
  });
  if (!online || (q.isError && isUnsupported(q.error))) return null;
  const line = q.data ? agyStatusLine(q.data) : q.isError ? "Couldn't check the sign-in" : "Checking…";
  if (line === null) return null;
  return (
    <FormSection title="Sign-ins">
      <ListRow
        title="Antigravity"
        subtitle={line}
        dimmed={!q.data}
        trailing={
          q.data ? (
            <Button size="compact-sm" variant="light" onClick={() => openSignIn(account, machine.id)}>
              {q.data.authenticated ? "Sign in again" : "Sign in"}
            </Button>
          ) : undefined
        }
      />
    </FormSection>
  );
}
