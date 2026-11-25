import { describe, expect, it } from "vitest";
import { parseStartupResumeReply, startupResume } from "./startupResume";

describe("startupResume", () => {
  it("is off without the flag", () => {
    expect(startupResume({})).toEqual({ enabled: false, message: "" });
    expect(startupResume({ resumeOnDaemonStart: false, resumeOnDaemonStartMessage: "go" })).toEqual({ enabled: false, message: "" });
  });
  it("reads the message, defaulting like the daemon", () => {
    expect(startupResume({ resumeOnDaemonStart: true, resumeOnDaemonStartMessage: " run the tests " })).toEqual({ enabled: true, message: "run the tests" });
    expect(startupResume({ resumeOnDaemonStart: true })).toEqual({ enabled: true, message: "continue" });
  });
  it("ignores the legacy daemon-written marker", () => {
    expect(startupResume({ resumeOnDaemonStart: true, resumeOnDaemonStartMessage: "This session stopped with unfinished todos. Continue them." }).enabled).toBe(false);
  });
});

describe("parseStartupResumeReply", () => {
  it("accepts ok replies", () => {
    expect(parseStartupResumeReply({ ok: true, enabled: true, message: "continue", metadataVersion: 7 })).toEqual({ message: "continue", metadataVersion: 7 });
  });
  it("throws the daemon's error", () => {
    expect(() => parseStartupResumeReply({ error: "session x does not belong to this machine" })).toThrow("does not belong");
    expect(() => parseStartupResumeReply(null)).toThrow();
  });
});
