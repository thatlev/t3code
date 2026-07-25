import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  addArchivedProjectKeys,
  isArchivedProject,
  projectArchiveKey,
  removeArchivedProjectKey,
} from "./projectArchive.ts";

const alpha = {
  environmentId: EnvironmentId.make("local"),
  id: ProjectId.make("alpha"),
};
const sameIdRemote = {
  environmentId: EnvironmentId.make("remote"),
  id: ProjectId.make("alpha"),
};

describe("project archive preferences", () => {
  it("scopes project identities by environment", () => {
    expect(projectArchiveKey(alpha)).toBe("local:alpha");
    expect(projectArchiveKey(sameIdRemote)).toBe("remote:alpha");
  });

  it("adds archive keys idempotently without losing existing entries", () => {
    expect(addArchivedProjectKeys(["existing:project", "local:alpha"], [alpha])).toEqual([
      "existing:project",
      "local:alpha",
    ]);
  });

  it("restores only the selected environment's project", () => {
    const archived = addArchivedProjectKeys([], [alpha, sameIdRemote]);
    const restored = removeArchivedProjectKey(archived, alpha);

    expect(isArchivedProject(new Set(restored), alpha)).toBe(false);
    expect(isArchivedProject(new Set(restored), sameIdRemote)).toBe(true);
  });
});
