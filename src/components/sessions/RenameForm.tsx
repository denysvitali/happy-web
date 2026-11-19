import { Button, Group, Stack, TextInput } from "@mantine/core";
import { useState } from "react";

interface Props {
  initial: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
  submitLabel?: string;
  maxLength?: number;
}

export function RenameForm({ initial, onSubmit, onCancel, submitLabel = "Rename", maxLength = 200 }: Props) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed) onSubmit(trimmed);
      }}
    >
      <Stack gap="md">
        <TextInput label="Name" value={value} onChange={(e) => setValue(e.currentTarget.value)} data-autofocus maxLength={maxLength} />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!trimmed || trimmed === initial}>
            {submitLabel}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
