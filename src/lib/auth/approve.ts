// Approving another device from this browser (happy_flutter's "scan QR"):
// a terminal (`happy auth login`) or another app shows an ephemeral X25519
// public key; we seal an answer to it and post it, and the server hands the
// waiting device a token.
//
// Terminal: data-key answer, 0x00 || account content public key. The machine
// makes its own key and seals data keys to ours, so it never gets the master
// secret (happy-cli-go internal/auth pollOnce also accepts a bare 32-byte
// secret, the legacy answer; we never send that to a terminal).
// Account (another browser or phone, happy:///account?<key>): the master
// secret itself; that device becomes a full client of the account.
import { decodeBase64Url } from "../crypto/base64";
import type { AccountKeys } from "../crypto/keys";
import { encryptForPublicKey } from "../crypto/primitives";

export type LinkKind = "terminal" | "account";

export interface LinkTarget {
  kind: LinkKind;
  publicKey: Uint8Array;
}

const KEY = /^[A-Za-z0-9_-]{43}=?$/;

function key(raw: string | null | undefined): Uint8Array | null {
  const s = raw?.trim();
  if (!s || !KEY.test(s)) return null;
  try {
    const k = decodeBase64Url(s.replace(/=$/, ""));
    return k.length === 32 ? k : null;
  } catch {
    return null;
  }
}

/**
 * Reads what a device shows to be linked:
 *   happy://terminal?<key>                  (terminal QR / manual URL)
 *   <webapp>/terminal/connect#key=<key>      (terminal "web authentication")
 *   happy:///account?<key>                   (another app's "link this device")
 */
export function parseLinkUrl(input: string): LinkTarget | null {
  const s = input.trim();
  let m = /^happy:\/\/terminal\?([^&#\s]+)$/.exec(s);
  if (m) return wrap("terminal", key(m[1]));
  m = /^happy:\/\/\/?account\?([^&#\s]+)$/.exec(s);
  if (m) return wrap("account", key(m[1]));
  m = /\/terminal\/connect\/?[?#]key=([^&#\s]+)$/.exec(s);
  if (m) return wrap("terminal", key(m[1]));
  return null;
}

const wrap = (kind: LinkKind, publicKey: Uint8Array | null): LinkTarget | null => (publicKey ? { kind, publicKey } : null);

/** The sealed answer for `target` (see the header for what each kind gets). */
export function sealLinkAnswer(target: LinkTarget, keys: AccountKeys): Uint8Array {
  if (target.kind === "account") return encryptForPublicKey(keys.secret, target.publicKey);
  const bundle = new Uint8Array(33);
  bundle.set(keys.content.publicKey, 1);
  return encryptForPublicKey(bundle, target.publicKey);
}
