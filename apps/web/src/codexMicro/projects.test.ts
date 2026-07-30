import { describe, expect, it } from "vite-plus/test";

import { decodeCodexMicroProject, encodeCodexMicroProject } from "./projects";

describe("codex micro project ids", () => {
  it("round-trips an environment-scoped project id", () => {
    const encoded = encodeCodexMicroProject("env-1", "project-1");
    expect(decodeCodexMicroProject(encoded)).toEqual({
      environmentId: "env-1",
      projectId: "project-1",
    });
  });

  it("keeps components separable when they contain the separator", () => {
    const encoded = encodeCodexMicroProject("env|a", "project|b");
    expect(encoded.split("|")).toHaveLength(2);
    expect(decodeCodexMicroProject(encoded)).toEqual({
      environmentId: "env|a",
      projectId: "project|b",
    });
  });

  it("rejects values that are not a scoped pair", () => {
    expect(decodeCodexMicroProject("project-1")).toBeNull();
    expect(decodeCodexMicroProject("|project-1")).toBeNull();
    expect(decodeCodexMicroProject("env-1|")).toBeNull();
  });

  it("rejects a malformed percent escape rather than throwing", () => {
    expect(decodeCodexMicroProject("env-1|%E0%A4%A")).toBeNull();
  });
});
