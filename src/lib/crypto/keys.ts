// Account key material derived from the 32-byte master secret, matching
// happy_flutter's DeriveKey (lib/core/encryption/derive_key.dart) and
// libsodium crypto_box_seed_keypair. Daemons seal data keys to the public key
// the app hands them, so Flutter is the authority here. Note:
// happy-cli-go's flutter_compat_test.go helper swaps the root HMAC arguments.
import nacl from "tweetnacl";
import { concatBytes } from "./base64";
import { decryptWithEphemeralKey } from "./primitives";

const enc = new TextEncoder();

async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as BufferSource));
}

/**
 * deriveKey(master, usage, path): HMAC-SHA512 key tree.
 *   root  = HMAC(key=utf8(usage + " Master Seed"), data=master) → key[0:32], chain[32:64]
 *   child = HMAC(key=chain,  data=0x00 || utf8(segment))  → key[0:32], chain[32:64]
 */
export async function deriveKey(master: Uint8Array, usage: string, path: string[]): Promise<Uint8Array> {
  let i = await hmacSha512(enc.encode(`${usage} Master Seed`), master);
  for (const segment of path) {
    i = await hmacSha512(i.subarray(32, 64), concatBytes(new Uint8Array([0]), enc.encode(segment)));
  }
  return i.slice(0, 32);
}

/** libsodium crypto_box_seed_keypair: sk = SHA-512(seed)[0:32]. */
export function boxKeyPairFromSeed(seed: Uint8Array): nacl.BoxKeyPair {
  return nacl.box.keyPair.fromSecretKey(nacl.hash(seed).slice(0, 32));
}

export interface AccountKeys {
  /** Master secret; also the legacy secretbox key for pre-data-key rows. */
  readonly secret: Uint8Array;
  /** X25519 keypair that per-session/machine data keys are sealed to. */
  readonly content: nacl.BoxKeyPair;
}

export async function deriveAccountKeys(secret: Uint8Array): Promise<AccountKeys> {
  if (secret.length !== 32) throw new Error("master secret must be 32 bytes");
  const seed = await deriveKey(secret, "Happy EnCoder", ["content"]);
  return { secret, content: boxKeyPairFromSeed(seed) };
}

/**
 * Opens a wrapped data encryption key: 0x00 || ephemeralPub || nonce || box(key).
 */
export function openDataEncryptionKey(wrapped: Uint8Array, keys: AccountKeys): Uint8Array {
  if (wrapped.length < 1 || wrapped[0] !== 0) throw new Error("unsupported data encryption key version");
  return decryptWithEphemeralKey(wrapped.subarray(1), keys.content.secretKey);
}
