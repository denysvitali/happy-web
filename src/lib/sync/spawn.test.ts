import { describe, expect, it } from "vitest";
import { backendRequestValue, initialBackend, kubernetesCheckoutPath, spawnBackends } from "./spawn";

describe("spawn helpers (Flutter parity)", () => {
  it("derives the Kubernetes checkout path from the repo URL", () => {
    expect(kubernetesCheckoutPath({}, "https://github.com/acme/My.Repo.git")).toBe("/workspace/my.repo");
    expect(kubernetesCheckoutPath({}, "git@github.com:acme/happy-web")).toBe("/workspace/happy-web");
    expect(kubernetesCheckoutPath({ kubernetesCheckoutBaseDir: "/src/" }, "https://x/y/Foo Bar/")).toBe("/src/foo-bar");
    expect(kubernetesCheckoutPath({}, "https://x/---")).toBe("/workspace/repository");
  });

  it("chooses backends like Flutter", () => {
    expect(spawnBackends({})).toEqual(["local"]);
    expect(initialBackend({ spawnBackends: ["kubernetes", "local"] })).toBe("local");
    expect(initialBackend({ spawnBackends: ["kubernetes"] })).toBe("kubernetes");
    expect(backendRequestValue({}, "kubernetes")).toBeUndefined();
    expect(backendRequestValue({ spawnBackends: ["local"] }, "kubernetes")).toBe("local");
    expect(backendRequestValue({ spawnBackends: ["local", "kubernetes"] }, "kubernetes")).toBe("kubernetes");
  });
});
