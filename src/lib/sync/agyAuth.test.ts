import { describe, expect, it } from "vitest";
import { agyStatusLine, isFlowOver, parseAgyBegin, parseAgyStatus } from "./agyAuth";

describe("agy sign-in", () => {
  it("parses protojson status replies leniently", () => {
    expect(parseAgyStatus({ flowId: "", status: "authenticated", success: true, authenticated: true, error: "" })).toEqual({
      flowId: "",
      status: "authenticated",
      authenticated: true,
      error: "",
    });
    expect(parseAgyStatus({ status: "unsupported", error: "needs Kubernetes" })).toMatchObject({ status: "unsupported", authenticated: false, error: "needs Kubernetes" });
    expect(() => parseAgyStatus("nope")).toThrow(/unexpected reply/);
  });

  it("accepts only Google's sign-in link", () => {
    const url = "https://accounts.google.com/o/oauth2/auth?client_id=x&state=s";
    expect(parseAgyBegin({ flowId: "f", authorizationUrl: url, expiresAt: "1795650000", status: "waiting_for_response" })).toEqual({ flowId: "f", url });
    expect(() => parseAgyBegin({ flowId: "f", authorizationUrl: "https://accounts.google.com.evil.test/x" })).toThrow(/not Google/);
    expect(() => parseAgyBegin({ flowId: "f", authorizationUrl: "javascript:alert(1)" })).toThrow();
    expect(() => parseAgyBegin({ flowId: "", authorizationUrl: url })).toThrow(/unexpected reply/);
  });

  it("describes the stored login, and hides it where sign-in is unsupported", () => {
    const s = (status: string) => ({ flowId: "", status, authenticated: status === "authenticated", error: "" });
    expect(agyStatusLine(s("authenticated"))).toMatch(/^Signed in/);
    expect(agyStatusLine(s("signed_out"))).toBe("Not signed in");
    expect(agyStatusLine(s("invalid"))).toMatch(/sign in again/);
    expect(agyStatusLine(s("unsupported"))).toBeNull();
    expect(isFlowOver(s("completing"))).toBe(false);
    expect(isFlowOver(s("failed"))).toBe(true);
  });
});
