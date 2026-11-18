import { ActionIcon, Alert, Badge, Box, Button, Code, Collapse, CopyButton, Group, Loader, Paper, Stack, Text, ThemeIcon, Tooltip, UnstyledButton } from "@mantine/core";
import { Bot, Brain, Check, ChevronRight, CircleAlert, Copy, ShieldQuestion, Wrench } from "lucide-react";
import { useState } from "react";
import type { Block, PermissionView } from "@/lib/sync/chat";
import { Markdown } from "./markdown";
import classes from "./chat.module.css";

export interface PermissionHandler {
  (id: string, approved: boolean, decision?: "approved_for_session"): Promise<void>;
}

const MAX_PREVIEW = 20_000;

function asText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.every((b) => typeof b === "object" && b && "text" in b)) {
    return v.map((b: { text?: unknown }) => String(b.text ?? "")).join("\n");
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

const clip = (s: string) => (s.length > MAX_PREVIEW ? `${s.slice(0, MAX_PREVIEW)}\n… (${s.length - MAX_PREVIEW} more characters)` : s);

function Copy_({ text }: { text: string }) {
  return (
    <CopyButton value={text} timeout={1200}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? "Copied" : "Copy"} withArrow>
          <ActionIcon size="sm" variant="subtle" color={copied ? "teal" : "gray"} onClick={copy} className={classes.copy} aria-label="Copy">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </ActionIcon>
        </Tooltip>
      )}
    </CopyButton>
  );
}

function toolSummary(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  const pick = ["description", "command", "file_path", "path", "pattern", "url", "query", "prompt"].find((k) => typeof i[k] === "string" && i[k]);
  const v = pick ? String(i[pick]) : "";
  return name === "Agent" && typeof i.agentId === "string" && !v ? i.agentId : v.split("\n")[0]!.slice(0, 140);
}

function PermissionBar({ id, perm, onPermission }: { id: string; perm?: PermissionView | undefined; onPermission?: PermissionHandler | undefined }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!perm) return null;
  if (perm.status !== "pending") {
    const ok = perm.status === "approved";
    return (
      <Badge variant="light" color={ok ? "green" : "red"} size="sm">
        {perm.status}
        {"reason" in perm && perm.reason ? `: ${perm.reason}` : ""}
      </Badge>
    );
  }
  const answer = async (key: string, approved: boolean, decision?: "approved_for_session") => {
    if (!onPermission) return;
    setBusy(key);
    setError("");
    try {
      await onPermission(id, approved, decision);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Alert color="yellow" variant="light" icon={<ShieldQuestion size={18} />} title="Permission required" p="sm">
      <Group gap="xs" mt={4}>
        <Button size="xs" loading={busy === "allow"} disabled={!!busy} onClick={() => void answer("allow", true)}>
          Allow
        </Button>
        <Button size="xs" variant="default" loading={busy === "session"} disabled={!!busy} onClick={() => void answer("session", true, "approved_for_session")}>
          Allow for session
        </Button>
        <Button size="xs" variant="light" color="red" loading={busy === "deny"} disabled={!!busy} onClick={() => void answer("deny", false)}>
          Deny
        </Button>
      </Group>
      {error && (
        <Text size="xs" c="red" mt={4}>
          {error}
        </Text>
      )}
    </Alert>
  );
}

function Pre({ label, text, error }: { label: string; text: string; error?: boolean }) {
  if (!text) return null;
  return (
    <Box className={classes.hoverable}>
      <Group justify="space-between" gap={4} mb={2}>
        <Text size="xs" c="dimmed" fw={500}>
          {label}
        </Text>
        <Copy_ text={text} />
      </Group>
      <Code block className={classes.pre} c={error ? "red" : undefined}>
        {clip(text)}
      </Code>
    </Box>
  );
}

function ToolBlock({ b, onPermission }: { b: Extract<Block, { type: "tool" }>; onPermission?: PermissionHandler | undefined }) {
  const isAgent = b.name === "Agent" || b.name === "Task";
  const [open, setOpen] = useState(isAgent || b.permission?.status === "pending");
  const state = b.result ? (b.result.isError ? "error" : "done") : "running";
  return (
    <Stack gap={6}>
      <Paper withBorder radius="md" className={isAgent ? classes.agent : undefined}>
        <UnstyledButton onClick={() => setOpen((o) => !o)} className={classes.toolHeader} aria-expanded={open}>
          <Group gap="xs" wrap="nowrap">
            <ChevronRight size={14} className={classes.chevron} data-open={open || undefined} />
            <ThemeIcon size="sm" variant="light" color={isAgent ? "violet" : "gray"}>
              {isAgent ? <Bot size={14} /> : <Wrench size={14} />}
            </ThemeIcon>
            <Text size="sm" fw={600}>
              {b.name}
            </Text>
            <Text size="xs" c="dimmed" ff="monospace" truncate style={{ flex: 1 }}>
              {toolSummary(b.name, b.input)}
            </Text>
            {state === "running" && <Loader size={14} />}
            {state === "done" && <Check size={16} color="var(--mantine-color-green-6)" />}
            {state === "error" && <CircleAlert size={16} color="var(--mantine-color-red-6)" />}
          </Group>
        </UnstyledButton>
        <Collapse expanded={open}>
          <Stack gap="xs" px="sm" pb="sm">
            {!isAgent && b.input !== undefined && <Pre label="Input" text={asText(b.input)} />}
            {!isAgent && b.result && <Pre label={b.result.isError ? "Error" : "Output"} text={asText(b.result.output)} error={b.result.isError} />}
            {b.children.length > 0 && (
              <Stack gap="xs" className={classes.children}>
                <BlockList blocks={b.children} onPermission={onPermission} />
              </Stack>
            )}
            {isAgent && b.children.length === 0 && (
              <Text size="xs" c="dimmed">
                No activity yet
              </Text>
            )}
          </Stack>
        </Collapse>
      </Paper>
      <PermissionBar id={b.id} perm={b.permission} onPermission={onPermission} />
    </Stack>
  );
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <UnstyledButton onClick={() => setOpen((o) => !o)}>
        <Group gap={4}>
          <Brain size={14} color="var(--mantine-color-dimmed)" />
          <Text size="xs" c="dimmed" fs="italic">
            Thinking
          </Text>
          <ChevronRight size={12} className={classes.chevron} data-open={open || undefined} color="var(--mantine-color-dimmed)" />
        </Group>
      </UnstyledButton>
      <Collapse expanded={open}>
        <Text size="xs" c="dimmed" className={classes.thinking}>
          {text}
        </Text>
      </Collapse>
    </div>
  );
}

export function BlockView({ b, onPermission }: { b: Block; onPermission?: PermissionHandler | undefined }) {
  switch (b.type) {
    case "user":
      return (
        <Group justify="flex-end" gap={4} wrap="nowrap" className={classes.hoverable} align="flex-start">
          <Copy_ text={b.text} />
          <Paper className={classes.user} data-pending={b.pending} radius="lg" px="md" py="xs">
            <Text size="sm" className={classes.userText}>
              {b.text}
            </Text>
            {b.pending === "failed" && (
              <Text size="xs" c="red.2">
                Not sent
              </Text>
            )}
          </Paper>
        </Group>
      );
    case "text":
      return (
        <Group gap={4} wrap="nowrap" align="flex-start" className={classes.hoverable}>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Markdown text={b.text} />
            {b.streaming && <span className="stream-caret" />}
          </Box>
          <Copy_ text={b.text} />
        </Group>
      );
    case "thinking":
      return <Thinking text={b.text} />;
    case "event":
      return (
        <Text size="xs" c="dimmed" ta="center">
          — {b.text} —
        </Text>
      );
    case "unknown":
      return (
        <Text size="xs" c="dimmed" fs="italic">
          Unsupported message ({b.label})
        </Text>
      );
    case "tool":
      return <ToolBlock b={b} onPermission={onPermission} />;
    case "permission":
      return (
        <Stack gap={6}>
          <Group gap="xs">
            <Wrench size={14} />
            <Text size="sm" fw={600}>
              {b.tool}
            </Text>
            <Text size="xs" c="dimmed" ff="monospace" truncate>
              {toolSummary(b.tool, b.input)}
            </Text>
          </Group>
          <PermissionBar id={b.id} perm={{ status: "pending" }} onPermission={onPermission} />
        </Stack>
      );
  }
}

export function BlockList({ blocks, onPermission }: { blocks: Block[]; onPermission?: PermissionHandler | undefined }) {
  return (
    <>
      {blocks.map((b) => (
        <BlockView key={b.key} b={b} onPermission={onPermission} />
      ))}
    </>
  );
}
