import { describe, expect, it } from "vitest";
import { isUnsupported, parseDaemon, parseVersions, statusLine, statusNote, updateAction } from "./machineUpdates";
import { RpcError } from "../realtime/socket";

const base = { version: "1.0.0", latestVersion: "1.1.0", updateAvailable: true, canUpdate: true, updateStatus: "idle" as const };

describe("machine updates", () => {
  it("parses replies leniently and keeps the status next to an error", () => {
    const r = parseVersions({ success: false, error: "Version check did not finish", providers: [{ provider: "claude", installed: true, version: "2.0.0", updateStatus: "weird" }] });
    expect(r.error).toBe("Version check did not finish");
    expect(r.value[0]).toMatchObject({ provider: "claude", version: "2.0.0", updateStatus: "idle", canUpdate: false });
    expect(parseDaemon({ success: true, daemon: base }).value).toMatchObject(base);
    expect(() => parseDaemon("nope")).toThrow(/unexpected reply/);
  });

  it("offers an update only when one can run", () => {
    expect(updateAction(base)).toBe("Update");
    expect(updateAction({ ...base, updateStatus: "failed" })).toBe("Retry");
    expect(updateAction({ ...base, canUpdate: false })).toBeNull();
    expect(updateAction({ ...base, updateStatus: "running" })).toBeNull();
    expect(updateAction({ ...base, updateAvailable: false })).toBeNull();
    expect(updateAction({ ...base, installed: false })).toBeNull();
  });

  it("describes the state in one line, with the reason as a note", () => {
    expect(statusLine(base)).toBe("v1.0.0 · 1.1.0 available");
    expect(statusLine({ ...base, updateAvailable: false, latestVersion: "1.0.0" })).toBe("v1.0.0 · up to date");
    expect(statusLine({ ...base, updateStatus: "running" })).toBe("Updating to 1.1.0…");
    expect(statusLine({ ...base, installed: false })).toBe("Not installed");
    expect(statusNote({ ...base, canUpdate: false, updateMessage: "Installed by Homebrew; run brew upgrade." })).toBe("Installed by Homebrew; run brew upgrade.");
    expect(statusNote({ ...base, updateStatus: "failed", updateError: "npm exited 1" })).toBe("npm exited 1");
    expect(statusNote(base)).toBeUndefined();
  });

  it("recognises daemons without the RPC", () => {
    expect(isUnsupported(new RpcError("method not found", "method_unsupported"))).toBe(true);
    // What the server answers today when no daemon registered the method.
    expect(isUnsupported(new RpcError("no handler", "handler_offline"))).toBe(true);
    expect(isUnsupported(new RpcError("RPC timed out", "timeout"))).toBe(false);
  });
});
