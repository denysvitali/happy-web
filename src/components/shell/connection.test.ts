import { describe, expect, it } from "vitest";
import { linkOf, troubleOf } from "./connection";

describe("linkOf", () => {
  it("trusts a live socket over navigator.onLine", () => {
    expect(linkOf(true, "online")).toBe("online");
    expect(linkOf(false, "online")).toBe("online");
  });
  it("a down socket is reconnecting unless the browser is offline", () => {
    expect(linkOf(true, "connecting")).toBe("connecting");
    expect(linkOf(false, "connecting")).toBe("offline");
  });
});

describe("troubleOf", () => {
  it("maps the link to the banner", () => {
    expect(troubleOf("online")).toBeNull();
    expect(troubleOf("connecting")).toBe("reconnecting");
    expect(troubleOf("offline")).toBe("offline");
  });
});
