import { describe, expect, it } from "vitest";
import { createSimpleDemo } from "./mockData";
import { filterSessions, summarizeProjects } from "./model";

describe("briefing overview model", () => {
  const fixedNow = Date.UTC(2026, 10, 26, 21, 0, 0);

  it("groups active and older sessions per project with rolled-up dot state", () => {
    const { projects, sessions } = createSimpleDemo(fixedNow);
    const byId = new Map(summarizeProjects(projects, sessions).map((g) => [g.project.id, g]));
    expect(byId.get("happy")?.active).toHaveLength(2);
    expect(byId.get("happy")?.dot).toBe("attention");
    expect(byId.get("re")?.active).toHaveLength(1);
    expect(byId.get("re")?.dot).toBe("paused");
    expect(byId.get("public")?.active).toHaveLength(0);
    expect(byId.get("public")?.older).toHaveLength(1);
  });

  it("filters sessions by title, status line, repo, or project name", () => {
    const { projects, sessions } = createSimpleDemo(fixedNow);
    expect(filterSessions(sessions, projects, "Protobuf").map((s) => s.id)).toEqual(["s-k2-wire"]);
    expect(filterSessions(sessions, projects, "Public").map((s) => s.id)).toEqual(["s-public-post"]);
  });
});
