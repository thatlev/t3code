import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

export type ProjectArchiveIdentity = {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
};

export function projectArchiveKey(project: ProjectArchiveIdentity): string {
  return scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
}

export function addArchivedProjectKeys(
  current: readonly string[],
  projects: readonly ProjectArchiveIdentity[],
): string[] {
  const next = new Set(current);
  for (const project of projects) next.add(projectArchiveKey(project));
  return [...next];
}

export function removeArchivedProjectKey(
  current: readonly string[],
  project: ProjectArchiveIdentity,
): string[] {
  const key = projectArchiveKey(project);
  return current.filter((candidate) => candidate !== key);
}

export function isArchivedProject(
  archivedProjectKeys: ReadonlySet<string>,
  project: ProjectArchiveIdentity,
): boolean {
  return archivedProjectKeys.has(projectArchiveKey(project));
}
