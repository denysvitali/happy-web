// Wire-level primitives mirroring happy-cli-go internal/api/cryptoutil.
//
// - Legacy:   nonce(24) || secretbox(json)                (NaCl secretbox)
// - Data key: 0x00 || nonce(12) || AES-256-GCM(json)||tag  (WebCrypto)
// - Box:      ephemeralPub(32) || nonce(24) || box(msg)   (NaCl box)
import nacl from "tweetnacl";
import { concatBytes } from "./base64";

/** Matches cryptoutil.maxDecodedJSONBytes: refuse to parse huge plaintexts. */
export const MAX_DECODED_JSON_BYTES = 4 * 1024 * 1024;

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

function parseBoundedJson(plain: Uint8Array): unknown {
  if (plain.length > MAX_DECODED_JSON_BYTES) {
    throw new Error(`decrypted payload too large: ${plain.length} bytes`);
  }
  return JSON.parse(dec.decode(plain));
}

// ---- Legacy (NaCl secretbox) ------------------------------------------------

export function encryptLegacyBytes(plain: Uint8Array, key: Uint8Array): Uint8Array {
  const nonce = randomBytes(nacl.secretbox.nonceLength);
  return concatBytes(nonce, nacl.secretbox(plain, nonce, key));
}

export function decryptLegacyBytes(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (data.length < 24) throw new Error("ciphertext too short");
  const out = nacl.secretbox.open(data.subarray(24), data.subarray(0, 24), key);
  if (!out) throw new Error("decrypt failed");
  return out;
}

export function encryptLegacyJson(value: unknown, key: Uint8Array): Uint8Array {
  return encryptLegacyBytes(enc.encode(JSON.stringify(value)), key);
}

export function decryptLegacyJson(data: Uint8Array, key: Uint8Array): unknown {
  return parseBoundedJson(decryptLegacyBytes(data, key));
}

// ---- Data key (AES-256-GCM) -------------------------------------------------

const GCM_NONCE = 12;

/** Imports a raw 32-byte AES key as a non-extractable WebCrypto key. */
export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error(`invalid data key length: ${raw.length}`);
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptDataKeyJson(value: unknown, key: CryptoKey): Promise<Uint8Array> {
  const nonce = randomBytes(GCM_NONCE);
  const plain = enc.encode(JSON.stringify(value));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, plain as BufferSource),
  );
  return concatBytes(new Uint8Array([0]), nonce, sealed);
}

export async function decryptDataKeyJson(data: Uint8Array, key: CryptoKey): Promise<unknown> {
  if (data.length < 1 || data[0] !== 0) throw new Error("unsupported data-key payload version");
  if (data.length < 1 + GCM_NONCE) throw new Error("ciphertext too short");
  const nonce = data.subarray(1, 1 + GCM_NONCE);
  const body = data.subarray(1 + GCM_NONCE);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, body as BufferSource);
  return parseBoundedJson(new Uint8Array(plain));
}

// ---- Ephemeral NaCl box -----------------------------------------------------

export function encryptForPublicKey(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  if (recipientPublicKey.length !== 32) {
    throw new Error(`invalid public key length: expected 32, got ${recipientPublicKey.length}`);
  }
  const eph = nacl.box.keyPair();
  const nonce = randomBytes(nacl.box.nonceLength);
  return concatBytes(eph.publicKey, nonce, nacl.box(message, nonce, recipientPublicKey, eph.secretKey));
}

export function decryptWithEphemeralKey(bundle: Uint8Array, recipientSecretKey: Uint8Array): Uint8Array {
  if (bundle.length < 32 + 24) throw new Error("invalid bundle length");
  const out = nacl.box.open(bundle.subarray(56), bundle.subarray(32, 56), bundle.subarray(0, 32), recipientSecretKey);
  if (!out) throw new Error("failed to decrypt bundle");
  return out;
}
