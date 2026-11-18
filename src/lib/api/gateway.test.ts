import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { AuthService, AccountAuthRequestSchema } from "@/gen/auth_pb";
import { SessionService, DeleteSessionRequestSchema, GetMessagesV3RequestSchema } from "@/gen/sessions_pb";
import { buildRequest } from "./gateway";

describe("buildRequest", () => {
  it("POST body '*' sends protobuf JSON", () => {
    const r = buildRequest(AuthService.method.requestAccountAuth, create(AccountAuthRequestSchema, { publicKey: "pk" }));
    expect(r).toEqual({ verb: "POST", path: "/v1/auth/account/request", body: { publicKey: "pk" } });
  });

  it("expands path params and puts the rest in the query for GET", () => {
    const r = buildRequest(
      SessionService.method.getMessagesV3,
      create(GetMessagesV3RequestSchema, { sessionId: "a/b", afterSeq: 5, limit: 10 }),
    );
    expect(r.verb).toBe("GET");
    expect(r.path).toBe("/v3/sessions/a%2Fb/messages");
    expect(r.query).toEqual({ afterSeq: "5", limit: "10" });
  });

  it("supports DELETE", () => {
    const r = buildRequest(SessionService.method.deleteSession, create(DeleteSessionRequestSchema, { sessionId: "s1" }));
    expect(r.verb).toBe("DELETE");
    expect(r.path).toBe("/v1/sessions/s1");
  });

  it("rejects a missing path field", () => {
    expect(() => buildRequest(SessionService.method.deleteSession, create(DeleteSessionRequestSchema, {}))).toThrow(
      "missing path field",
    );
  });
});
