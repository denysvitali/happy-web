import { describe, expect, it } from "vitest";
import { troubleOf } from "./connection";

describe("troubleOf", () => {
  it("is quiet while the socket is live", () => expect(troubleOf(true, "online")).toBeNull());
  it("reports a reconnecting socket", () => {
    expect(troubleOf(true, "connecting")).toBe("reconnecting");
    expect(troubleOf(true, "offline")).toBe("reconnecting");
  });
  it("browser offline wins", () => expect(troubleOf(false, "online")).toBe("offline"));
});
