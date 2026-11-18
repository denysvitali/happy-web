// "Link this browser" from the Happy app (account auth request/approve flow,
// happy_flutter auth_service.dart). The browser shows happy:///account?<key>,
// where <key> is an ephemeral X25519 public key; the approving app sends back
// box(masterSecret, key) and the server hands us a token.
import nacl from "tweetnacl";
import { AuthService } from "@/gen/auth_pb";
import { callGateway } from "../api/gateway";
import { HttpError } from "../api/http";
import { decodeBase64, encodeBase64, encodeBase64Url } from "../crypto/base64";
import { decryptWithEphemeralKey } from "../crypto/primitives";
import { markDecrypted, type Decrypted } from "../decrypted";

export interface LinkResult {
  token: string;
  secret: Decrypted<Uint8Array>;
}

export interface LinkRequest {
  qrUrl: string;
  /** Polls until approved, aborted, or timed out. */
  wait(signal: AbortSignal): Promise<LinkResult>;
}

export const LINK_POLL_MS = 1000;
export const LINK_TIMEOUT_MS = 5 * 60_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });

export function startLink(serverUrl: string): LinkRequest {
  const kp = nacl.box.keyPair();
  const publicKey = encodeBase64(kp.publicKey);
  return {
    qrUrl: `happy:///account?${encodeBase64Url(kp.publicKey)}`,
    async wait(signal) {
      const deadline = Date.now() + LINK_TIMEOUT_MS;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        try {
          const res = await callGateway(serverUrl, AuthService.method.requestAccountAuth, { publicKey }, { signal });
          if (res.state === "authorized" && res.token && res.response) {
            const secret = decryptWithEphemeralKey(decodeBase64(res.response), kp.secretKey);
            kp.secretKey.fill(0);
            if (secret.length !== 32) throw new Error("unexpected secret length from approving device");
            return { token: res.token, secret: markDecrypted(secret) };
          }
        } catch (e) {
          // Client errors are final; network blips and 5xx keep polling.
          if (e instanceof HttpError && e.status >= 400 && e.status < 500) throw e;
          if (signal.aborted) throw e;
          if (!(e instanceof HttpError) && !(e instanceof TypeError)) throw e;
        }
        await sleep(LINK_POLL_MS, signal);
      }
      throw new Error("Link request expired. Start again.");
    },
  };
}
