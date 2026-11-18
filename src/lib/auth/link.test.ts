import nacl from "tweetnacl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeBase64, decodeBase64Url, encodeBase64 } from "../crypto/base64";
import { encryptForPublicKey } from "../crypto/primitives";
import { startLink } from "./link";

afterEach(() => vi.unstubAllGlobals());

describe("startLink", () => {
  it("polls account auth until approved and opens the secret", async () => {
    const secret = nacl.randomBytes(32);
    const link = startLink("https://h.example");
    expect(link.qrUrl).toMatch(/^happy:\/\/\/account\?[A-Za-z0-9_-]{43}$/);
    const pub = decodeBase64Url(link.qrUrl.split("?")[1]!);
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        expect(url.toString()).toBe("https://h.example/v1/auth/account/request");
        expect(JSON.parse(init.body as string)).toEqual({ publicKey: encodeBase64(pub) });
        calls++;
        const body =
          calls < 2
            ? { state: "requested" }
            : { state: "authorized", token: "tok", response: encodeBase64(encryptForPublicKey(secret, pub)) };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const p = link.wait(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1500);
    const res = await p;
    vi.useRealTimers();
    expect(res.token).toBe("tok");
    expect(Array.from(res.secret)).toEqual(Array.from(secret));
    expect(decodeBase64(encodeBase64(pub))).toEqual(pub);
  });

  it("fails fast on 4xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"nope"}', { status: 403 })));
    await expect(startLink("https://h.example").wait(new AbortController().signal)).rejects.toThrow("HTTP 403");
  });
});
