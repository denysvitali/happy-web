import { Button, Group, Stack, TextInput } from "@mantine/core";
import { useState } from "react";

export function RenameForm({ initial, onSubmit, onCancel }: { initial: string; onSubmit: (name: string) => void; onCancel: () => void }) {
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
        <TextInput label="Name" value={value} onChange={(e) => setValue(e.currentTarget.value)} data-autofocus maxLength={200} />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!trimmed || trimmed === initial}>
            Rename
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
