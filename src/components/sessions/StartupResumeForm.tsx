import { Button, Group, Stack, Switch, Text, Textarea } from "@mantine/core";
import { useState } from "react";
import { DEFAULT_RESUME_MESSAGE, type StartupResume } from "@/lib/sync/startupResume";

interface Props {
  initial: StartupResume;
  onSubmit: (next: StartupResume) => void;
  onCancel: () => void;
}

/** "Continue after restart": on/off plus the message the daemon sends. */
export function StartupResumeForm({ initial, onSubmit, onCancel }: Props) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [message, setMessage] = useState(initial.enabled ? initial.message : "");
  const trimmed = message.trim() || DEFAULT_RESUME_MESSAGE;
  const unchanged = enabled === initial.enabled && (!enabled || trimmed === initial.message);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ enabled, message: enabled ? trimmed : "" });
      }}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          When the daemon restarts or the machine reboots, this session is started again and sent the message below.
        </Text>
        <Switch label="Continue after restart" checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} />
        <Textarea
          label="Message"
          placeholder={DEFAULT_RESUME_MESSAGE}
          value={message}
          onChange={(e) => setMessage(e.currentTarget.value)}
          disabled={!enabled}
          autosize
          minRows={2}
          maxRows={8}
          data-autofocus
        />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={unchanged}>
            Save
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
