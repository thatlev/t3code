import { describe, expect, it } from "vite-plus/test";

import { decodeAgentMicroProject, encodeAgentMicroProject } from "./projects";

describe("codex micro project ids", () => {
  it("round-trips an environment-scoped project id", () => {
    const encoded = encodeAgentMicroProject("env-1", "project-1");
    expect(decodeAgentMicroProject(encoded)).toEqual({
      environmentId: "env-1",
      projectId: "project-1",
    });
  });

  it("keeps components separable when they contain the separator", () => {
    const encoded = encodeAgentMicroProject("env|a", "project|b");
    expect(encoded.split("|")).toHaveLength(2);
    expect(decodeAgentMicroProject(encoded)).toEqual({
      environmentId: "env|a",
      projectId: "project|b",
    });
  });

  it("rejects values that are not a scoped pair", () => {
    expect(decodeAgentMicroProject("project-1")).toBeNull();
    expect(decodeAgentMicroProject("|project-1")).toBeNull();
    expect(decodeAgentMicroProject("env-1|")).toBeNull();
  });

  it("rejects a malformed percent escape rather than throwing", () => {
    expect(decodeAgentMicroProject("env-1|%E0%A4%A")).toBeNull();
  });
});
