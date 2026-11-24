import { describe, expect, it } from "vitest";
import { renameMachineMeta } from "./machineRename";

describe("renameMachineMeta", () => {
  const raw = { host: "laptop", displayName: "denys@laptop (go)", sandboxEnabled: true };

  it("sets and marks the user's name, keeping every other field", () => {
    expect(renameMachineMeta(raw, "  Work laptop ")).toEqual({ host: "laptop", displayName: "Work laptop", displayNameByUser: true, sandboxEnabled: true });
  });

  it("resetting drops the name and the mark", () => {
    expect(renameMachineMeta({ ...raw, displayNameByUser: true }, null)).toEqual({ host: "laptop", displayNameByUser: false, sandboxEnabled: true });
  });

  it("refuses an empty name", () => {
    expect(() => renameMachineMeta(raw, "  ")).toThrow();
  });
});
