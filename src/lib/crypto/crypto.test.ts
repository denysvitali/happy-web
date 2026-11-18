import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import vectors from "./__fixtures__/go-vectors.json";
import { decodeBase64, decodeBase64Url, decodeHex, encodeBase64, encodeBase64Url, encodeHex } from "./base64";
import { deriveAccountKeys, openDataEncryptionKey } from "./keys";
import {
  decryptDataKeyJson,
  decryptLegacyJson,
  decryptWithEphemeralKey,
  encryptDataKeyJson,
  encryptForPublicKey,
  encryptLegacyJson,
  importAesKey,
} from "./primitives";

describe("go vectors", () => {
  const secret = decodeHex(vectors.masterSecretHex);

  it("derives the Flutter content keypair", async () => {
    const keys = await deriveAccountKeys(secret);
    expect(encodeHex(keys.content.publicKey)).toBe(vectors.contentPublicKeyHex);
  });

  it("decrypts Go legacy secretbox JSON", () => {
    expect(decryptLegacyJson(decodeBase64(vectors.legacyCiphertextB64), secret)).toEqual(vectors.payload);
  });

  it("decrypts Go AES-GCM data-key JSON", async () => {
    const key = await importAesKey(decodeHex(vectors.dataKeyHex));
    expect(await decryptDataKeyJson(decodeBase64(vectors.dataKeyCiphertextB64), key)).toEqual(vectors.payload);
  });

  it("opens a Go-wrapped data encryption key", async () => {
    const keys = await deriveAccountKeys(secret);
    const dek = openDataEncryptionKey(decodeBase64(vectors.wrappedDataKeyB64), keys);
    expect(encodeHex(dek)).toBe(vectors.dataKeyHex);
  });

  it("matches Go unpadded base64url", () => {
    expect(encodeBase64Url(decodeHex(vectors.base64UrlSampleHex))).toBe(vectors.base64UrlSample);
    expect(encodeHex(decodeBase64Url(vectors.base64UrlSample))).toBe(vectors.base64UrlSampleHex);
  });
});

describe("round trips", () => {
  it("legacy", () => {
    const key = nacl.randomBytes(32);
    expect(decryptLegacyJson(encryptLegacyJson({ a: 1 }, key), key)).toEqual({ a: 1 });
  });

  it("data key layout is 0x00 || nonce12 || ct||tag16", async () => {
    const key = await importAesKey(nacl.randomBytes(32));
    const ct = await encryptDataKeyJson({ hello: "world" }, key);
    expect(ct[0]).toBe(0);
    expect(ct.length).toBe(1 + 12 + JSON.stringify({ hello: "world" }).length + 16);
    expect(await decryptDataKeyJson(ct, key)).toEqual({ hello: "world" });
  });

  it("box bundle layout is pub32 || nonce24 || box", () => {
    const kp = nacl.box.keyPair();
    const msg = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const bundle = encryptForPublicKey(msg, kp.publicKey);
    expect(bundle.length).toBe(32 + 24 + 32 + 16);
    expect(decryptWithEphemeralKey(bundle, kp.secretKey)).toEqual(msg);
  });
});

describe("error cases (mirroring cryptoutil_test.go)", () => {
  it("rejects short legacy ciphertext", () => {
    expect(() => decryptLegacyJson(new Uint8Array(10), new Uint8Array(32))).toThrow("ciphertext too short");
  });
  it("rejects legacy ciphertext under the wrong key", () => {
    const ct = encryptLegacyJson({ a: 1 }, nacl.randomBytes(32));
    expect(() => decryptLegacyJson(ct, nacl.randomBytes(32))).toThrow("decrypt failed");
  });
  it("rejects unknown data-key version", async () => {
    const key = await importAesKey(nacl.randomBytes(32));
    await expect(decryptDataKeyJson(new Uint8Array([1, 2, 3]), key)).rejects.toThrow("unsupported");
  });
  it("rejects invalid AES key length", async () => {
    await expect(importAesKey(new Uint8Array(16))).rejects.toThrow("invalid data key length");
  });
  it("rejects short box bundles and bad public keys", () => {
    expect(() => decryptWithEphemeralKey(new Uint8Array(40), new Uint8Array(32))).toThrow("invalid bundle length");
    expect(() => encryptForPublicKey(new Uint8Array(1), new Uint8Array(16))).toThrow("invalid public key length");
  });
  it("base64 round trips arbitrary bytes", () => {
    const b = nacl.randomBytes(1000);
    expect(decodeBase64(encodeBase64(b))).toEqual(b);
  });
});
