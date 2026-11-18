import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { markDecrypted } from "../decrypted";
import { forgetDevice, loadCredentials, saveCredentials } from "./storage";

describe("credential storage", () => {
  it("saves, loads and forgets", async () => {
    expect(await loadCredentials()).toBeNull();
    const secret = markDecrypted(new Uint8Array(32).fill(7));
    await saveCredentials({ serverUrl: "https://h.example", token: "t", secret });
    const got = await loadCredentials();
    expect(got?.token).toBe("t");
    expect(Array.from(got!.secret)).toEqual(Array.from(secret));
    await forgetDevice();
    expect(await loadCredentials()).toBeNull();
  });
});
