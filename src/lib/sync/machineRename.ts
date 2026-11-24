// Renaming a machine: the user's name goes in `displayName`, marked
// `displayNameByUser` so the daemon stops republishing its own name over it
// on reconnect (happy-cli-go mergeMachineMetadata). Daemons from before that
// still overwrite it on their next reconnect.

/** Edits the full decrypted metadata (unknown fields pass through); `null`
 * hands the name back to the daemon, which republishes it on its next connect. */
export function renameMachineMeta(raw: Record<string, unknown>, name: string | null): Record<string, unknown> {
  if (name === null) {
    const { displayName: _, ...rest } = raw;
    return { ...rest, displayNameByUser: false };
  }
  const text = name.trim();
  if (!text) throw new Error("name is empty");
  return { ...raw, displayName: text, displayNameByUser: true };
}
