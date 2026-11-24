// Approve a device that wants into this account (lib/auth/approve.ts): a
// terminal running `happy auth login`, or another app or browser showing a
// link code. Opened from Settings → Machines and as the page a terminal's
// "web authentication" opens (/terminal/connect, routes/connect.tsx).
import { Button, Code, Text, Textarea } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { useState } from "react";
import { parseLinkUrl, type LinkKind } from "@/lib/auth/approve";
import type { Account } from "@/lib/sync/account";
import { Callout } from "@/ui/Callout";
import { FormRow, FormSection } from "@/ui/FormSection";
import { openSheet, SheetBody } from "@/ui/Sheet";
import classes from "./link.module.css";

const WHAT: Record<LinkKind, { title: string; body: string; tone: "info" | "warning"; done: string }> = {
  terminal: {
    title: "A terminal wants to join as a machine",
    body: "It will be able to start sessions in your account and read the ones it runs, not your other machines' sessions. Approve only if you just ran happy auth login on it.",
    tone: "info",
    done: "Machine approved. The terminal finishes on its own and shows up under Machines once its daemon starts.",
  },
  account: {
    title: "Another app wants full access",
    body: "It gets your account's secret key and can read every session, like this browser. Approve only a device you are holding right now.",
    tone: "warning",
    done: "Device linked. It signs in on its own in a moment.",
  },
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function LinkDevice({ account, initial = "", onDone }: { account: Account; initial?: string; onDone?: () => void }) {
  const [text, setText] = useState(initial);
  const target = parseLinkUrl(text);
  const approve = useMutation({ mutationFn: () => account.approveLink(target!) });
  const what = target && WHAT[target.kind];

  if (approve.isSuccess && what) {
    return (
      <div className={classes.stack}>
        <Callout tone="success" title="Approved">
          {what.done}
        </Callout>
        {onDone && (
          <Button fullWidth onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={classes.stack}>
      <FormSection
        title="Link code"
        footer={
          <>
            On the machine, run <Code>happy auth login</Code> and paste the <Code>happy://terminal?…</Code> or web URL it prints. Another
            browser's link code works too.
          </>
        }
      >
        <FormRow layout="bare">
          <Textarea
            aria-label="Link code"
            placeholder="happy://terminal?…"
            rows={3}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            classNames={{ input: classes.code }}
            value={text}
            onChange={(e) => {
              setText(e.currentTarget.value);
              approve.reset();
            }}
            error={text.trim() && !target ? "That isn't a Happy link code" : undefined}
            data-autofocus
          />
        </FormRow>
      </FormSection>
      {what && (
        <Callout tone={what.tone} title={what.title}>
          {what.body}
        </Callout>
      )}
      {approve.isError && (
        <Callout tone="danger" title="Couldn't approve">
          {/not found/i.test(errText(approve.error)) ? "The request expired or was already used. Start the login again on the device." : errText(approve.error)}
        </Callout>
      )}
      <Button fullWidth size="md" leftSection={<Link2 size={16} />} disabled={!target} loading={approve.isPending} onClick={() => approve.mutate()}>
        {target?.kind === "account" ? "Give full access" : "Approve machine"}
      </Button>
      {target?.kind !== "account" && (
        <Text size="xs" c="dimmed" ta="center">
          To unlink a machine later, run <Code>happy auth logout</Code> on it.
        </Text>
      )}
    </div>
  );
}

export function openLinkDevice(account: Account, initial?: string): void {
  openSheet({
    title: "Link a device",
    size: 480,
    children: (close) => (
      <SheetBody>
        <LinkDevice account={account} initial={initial} onDone={close} />
      </SheetBody>
    ),
  });
}
