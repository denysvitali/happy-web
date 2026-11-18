// Per-session / per-machine cipher. A row with a wrapped dataEncryptionKey
// uses AES-256-GCM (EncryptionDataKey); without one, or when it does not
// unwrap, the account secret is the secretbox key (EncryptionLegacy). This
// mirrors happy_flutter's encryption_manager.dart fallback.
import { markDecrypted, type Decrypted } from "../decrypted";
import { decodeBase64, encodeBase64 } from "./base64";
import { openDataEncryptionKey, type AccountKeys } from "./keys";
import {
  decryptDataKeyJson,
  decryptLegacyJson,
  encryptDataKeyJson,
  encryptLegacyJson,
  importAesKey,
} from "./primitives";

export interface Cipher {
  readonly variant: "legacy" | "dataKey";
  decrypt(b64: string): Promise<Decrypted<unknown>>;
  encrypt(value: unknown): Promise<string>;
}

export async function createCipher(keys: AccountKeys, wrappedDek: string | null | undefined): Promise<Cipher> {
  if (wrappedDek) {
    try {
      const aes = await importAesKey(openDataEncryptionKey(decodeBase64(wrappedDek), keys));
      return {
        variant: "dataKey",
        decrypt: async (b64) => markDecrypted(await decryptDataKeyJson(decodeBase64(b64), aes)),
        encrypt: async (v) => encodeBase64(await encryptDataKeyJson(v, aes)),
      };
    } catch {
      /* Flutter falls back to legacy when the key does not unwrap. */
    }
  }
  const secret = keys.secret;
  return {
    variant: "legacy",
    decrypt: async (b64) => markDecrypted(decryptLegacyJson(decodeBase64(b64), secret)),
    encrypt: async (v) => encodeBase64(encryptLegacyJson(v, secret)),
  };
}
