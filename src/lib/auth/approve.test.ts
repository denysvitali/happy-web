import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { encodeBase64Url } from "../crypto/base64";
import { deriveAccountKeys } from "../crypto/keys";
import { decryptWithEphemeralKey } from "../crypto/primitives";
import { parseLinkUrl, sealLinkAnswer } from "./approve";

const kp = nacl.box.keyPair();
const k = encodeBase64Url(kp.publicKey);

describe("parseLinkUrl", () => {
  it("reads every form a device shows", () => {
    for (const [url, kind] of [
      [`happy://terminal?${k}`, "terminal"],
      [`  https://app.example/terminal/connect#key=${k}\n`, "terminal"],
      [`https://app.example/base/terminal/connect/#key=${k}`, "terminal"],
      [`https://app.example/#/terminal/connect?key=${k}`, "terminal"],
      [`happy:///account?${k}`, "account"],
      [`happy://account?${k}`, "account"],
    ] as const) {
      const t = parseLinkUrl(url);
      expect(t?.kind, url).toBe(kind);
      expect(t?.publicKey).toEqual(kp.publicKey);
    }
  });

  it("rejects anything else", () => {
    for (const url of ["", k, `happy://terminal?${k.slice(1)}`, `happy://terminal?${k}x`, `https://evil/?key=${k}`, `happy://session?${k}`]) {
      expect(parseLinkUrl(url), url).toBeNull();
    }
  });
});

describe("sealLinkAnswer", () => {
  it("gives a terminal the data-key answer, never the secret", async () => {
    const keys = await deriveAccountKeys(new Uint8Array(32).fill(7));
    const out = decryptWithEphemeralKey(sealLinkAnswer({ kind: "terminal", publicKey: kp.publicKey }, keys), kp.secretKey);
    expect(out.length).toBe(33);
    expect(out[0]).toBe(0);
    expect(out.subarray(1)).toEqual(keys.content.publicKey);
  });

  it("gives another app the master secret", async () => {
    const keys = await deriveAccountKeys(new Uint8Array(32).fill(7));
    const out = decryptWithEphemeralKey(sealLinkAnswer({ kind: "account", publicKey: kp.publicKey }, keys), kp.secretKey);
    expect(out).toEqual(keys.secret);
  });
});
