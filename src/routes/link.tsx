import { Alert, Anchor, Button, Center, Code, Group, Loader, Paper, Stack, Stepper, Text, TextInput, Title } from "@mantine/core";
import { Pencil, RefreshCw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/app/auth";
import { QrCode } from "@/components/qr";
import { startLink, type LinkRequest } from "@/lib/auth/link";
import { defaultServerUrl, getServerUrl, isAllowedServerUrl, normalizeServerUrl, setServerUrl } from "@/lib/config";

function ServerStep({ onDone }: { onDone: () => void }) {
  const current = getServerUrl();
  const [value, setValue] = useState(current || defaultServerUrl());
  const [error, setError] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isAllowedServerUrl(value.trim())) {
      setError("Enter an https:// URL without credentials, query or fragment.");
      return;
    }
    const next = normalizeServerUrl(value);
    if (next === current) return onDone();
    setServerUrl(next);
    // Reload so the CSP narrows connect-src to the new origin.
    location.reload();
  };
  return (
    <form onSubmit={submit}>
      <Stack>
        <TextInput
          label="Happy server URL"
          description="Saved in this browser. Only this origin will be reachable."
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://happy.example.com"
          value={value}
          onChange={(e) => {
            setValue(e.currentTarget.value);
            setError("");
          }}
          error={error || undefined}
          data-autofocus
          autoFocus
        />
        <Button type="submit">Continue</Button>
      </Stack>
    </form>
  );
}

function LinkAttempt({ server, onRetry }: { server: string; onRetry: () => void }) {
  const { completeLink } = useAuth();
  const [req] = useState<LinkRequest>(() => startLink(server));
  const [error, setError] = useState("");

  useEffect(() => {
    const ctrl = new AbortController();
    req
      .wait(ctrl.signal)
      .then((res) => completeLink(res))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Linking failed");
      });
    return () => ctrl.abort();
  }, [req, completeLink]);

  if (error) {
    return (
      <Stack align="center">
        <Alert color="red" w="100%">
          {error}
        </Alert>
        <Button variant="default" leftSection={<RefreshCw size={16} />} onClick={onRetry}>
          Try again
        </Button>
      </Stack>
    );
  }
  return (
    <Stack align="center" gap="sm">
      <Paper withBorder p="xs" radius="md" bg="white">
        <QrCode value={req.qrUrl} size={220} />
      </Paper>
      <Text size="sm" ta="center">
        In the Happy app, open <b>Settings → Account → Link New Device</b> and scan this code.
      </Text>
      <Group gap="xs">
        <Loader size="xs" type="dots" />
        <Text size="xs" c="dimmed">
          Waiting for approval…
        </Text>
      </Group>
      <details style={{ width: "100%" }}>
        <summary>
          <Text span size="xs" c="dimmed">
            Can't scan? Copy the link
          </Text>
        </summary>
        <Code block mt="xs" style={{ wordBreak: "break-all", whiteSpace: "pre-wrap", userSelect: "all" }}>
          {req.qrUrl}
        </Code>
      </details>
    </Stack>
  );
}

export function LinkScreen({ note }: { note?: string | undefined }) {
  const server = getServerUrl();
  const [step, setStep] = useState(server ? 1 : 0);
  const [attempt, setAttempt] = useState(0);
  return (
    <Center mih="100dvh" p="md" style={{ overflow: "auto" }}>
      <Stack w="100%" maw={440} gap="lg">
        <div style={{ textAlign: "center" }}>
          <Title order={2}>Happy</Title>
          <Text c="dimmed" size="sm">
            Link this browser to your account
          </Text>
        </div>
        {note && <Alert color="yellow">{note}</Alert>}
        <Paper withBorder shadow="sm" p="lg" radius="lg">
          <Stepper active={step} onStepClick={(s) => s === 0 && setStep(0)} size="sm" mb="lg" allowNextStepsSelect={false}>
            <Stepper.Step label="Server" description={step > 0 ? new URL(server).host : "Choose"} />
            <Stepper.Step label="Approve" description="Scan with the app" />
          </Stepper>
          {step === 0 || !server ? (
            <ServerStep onDone={() => setStep(1)} />
          ) : (
            <Stack>
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs" c="dimmed" truncate>
                  {server}
                </Text>
                <Anchor component="button" size="xs" onClick={() => setStep(0)}>
                  <Group gap={4}>
                    <Pencil size={12} /> Change
                  </Group>
                </Anchor>
              </Group>
              <LinkAttempt key={attempt} server={server} onRetry={() => setAttempt((a) => a + 1)} />
            </Stack>
          )}
        </Paper>
      </Stack>
    </Center>
  );
}
