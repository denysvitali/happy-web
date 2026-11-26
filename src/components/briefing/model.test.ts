import { describe, expect, it } from "vitest";
import { createMockBriefing } from "./mockData";
import {
  isSweepCandidate,
  matchesGlob,
  resolveSpaceId,
  searchBriefing,
  summarizeSpaces,
  sweepSafety,
} from "./model";

describe("briefing model", () => {
  const fixedNow = Date.UTC(2026, 10, 26, 17, 0, 0);

  it("matches case-insensitive glob patterns for repo/host routing", () => {
    expect(matchesGlob("acme/happy-web", "*/happy-*")).toBe(true);
    expect(matchesGlob("tildeknown/linux-hi6250", "*/happy-*")).toBe(false);
    expect(matchesGlob("root@bach2 (go)", "*bach2*")).toBe(true);
  });

  it("auto-routes sessions to Spaces without manual folders", () => {
    const { spaces, sessions } = createMockBriefing(fixedNow);
    const byId = new Map(sessions.map((s) => [s.id, resolveSpaceId(s, spaces)]));
    expect(byId.get("bs-rollback")).toBe("happy");
    expect(byId.get("bs-k8s")).toBe("happy");
    expect(byId.get("bs-bach2")).toBe("linux");
    expect(byId.get("bs-k2-wire")).toBe("k2");
    expect(byId.get("bs-re-ioctl")).toBe("re");
    expect(byId.get("bs-public-blog")).toBe("public");
  });

  it("computes Space momentum and keeps quiet Spaces separate", () => {
    const { spaces, sessions, turns } = createMockBriefing(fixedNow);
    const summaries = new Map(summarizeSpaces(spaces, sessions, turns, fixedNow).map((s) => [s.space.id, s]));
    expect(summaries.get("happy")?.momentum).toBe("needs_you");
    expect(summaries.get("linux")?.momentum).toBe("needs_you");
    expect(summaries.get("k2")?.momentum).toBe("stalled");
    expect(summaries.get("public")?.momentum).toBe("quiet");
  });

  it("identifies sweep candidates and distinguishes clean vs caution", () => {
    const { sessions } = createMockBriefing(fixedNow);
    const candidates = sessions.filter((s) => isSweepCandidate(s, fixedNow));
    const safety = new Map(candidates.map((s) => [s.id, sweepSafety(s)]));
    expect(safety.get("bs-happy-ci")).toBe("clean");
    expect(safety.get("bs-galaxy-wifi")).toBe("clean");
    expect(safety.get("bs-re-strings")).toBe("clean");
    expect(safety.get("bs-re-ioctl")).toBe("caution");
    // Actively working session is never a sweep candidate.
    expect(safety.has("bs-bach2")).toBe(false);
  });

  it("searches across quiet Spaces, notebooks, milestones, and archived sessions", () => {
    const { spaces, sessions } = createMockBriefing(fixedNow);
    const pub = searchBriefing("Public", spaces, sessions);
    expect(pub.some((h) => h.kind === "space" && h.spaceId === "public")).toBe(true);
    const proto = searchBriefing("Protobuf", spaces, sessions);
    expect(proto.some((h) => h.kind === "session" && h.id === "bs-k2-wire")).toBe(true);
  });
});
