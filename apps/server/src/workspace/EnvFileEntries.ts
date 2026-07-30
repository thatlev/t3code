// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

import * as Effect from "effect/Effect";

import type { ProjectEntry } from "@t3tools/contracts";

/**
 * The workspace index is built by the `fff` file finder, which honours
 * `.gitignore` and skips dotfiles. That is the right default for a file
 * picker, but it makes `.env` — a file people genuinely want to open and edit
 * — permanently invisible in the file browser. The finder exposes no option to
 * include ignored or hidden paths, so env files are collected with a small
 * dedicated walk and merged into the indexed entries.
 *
 * The walk is deliberately bounded: env files live near the top of a project,
 * never inside build output, so a shallow scan that skips the usual heavy
 * directories finds every real one without becoming a second full traversal
 * on each listing.
 */
const MAX_DEPTH = 5;
const MAX_DIRECTORIES = 4_000;

const SKIPPED_DIRECTORY_NAMES = new Set([
  "__pycache__",
  "bower_components",
  "build",
  "coverage",
  "dist",
  "dist-electron",
  "node_modules",
  "out",
  "release",
  "target",
  "vendor",
  "venv",
]);

/** `.env`, plus every `.env.<suffix>` variant (`.env.local`, `.env.production`). */
export function isEnvFileName(name: string): boolean {
  return name === ".env" || name.startsWith(".env.");
}

/**
 * Dot-directories are skipped wholesale. `.git` alone would dominate the walk,
 * and no dot-directory holds an env file anyone browses to.
 */
export function shouldEnterDirectory(name: string): boolean {
  return !name.startsWith(".") && !SKIPPED_DIRECTORY_NAMES.has(name);
}

/**
 * Every directory on a path, so a merged env file is reachable in a tree built
 * from the flat entry list even when its parent is itself ignored (and so
 * absent from the index).
 */
export function directoryAncestors(relativePath: string): ReadonlyArray<string> {
  const segments = relativePath.split("/");
  const ancestors: Array<string> = [];
  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join("/"));
  }
  return ancestors;
}

/**
 * Merge env-file entries into indexed entries, skipping any path the index
 * already knows and adding the directories needed to reach the new files.
 * Returns the original array unchanged when there is nothing to add.
 */
export function mergeEnvFileEntries(
  entries: ReadonlyArray<ProjectEntry>,
  envRelativePaths: ReadonlyArray<string>,
): ReadonlyArray<ProjectEntry> {
  if (envRelativePaths.length === 0) return entries;
  const known = new Set(entries.map((entry) => entry.path));
  const added: Array<ProjectEntry> = [];
  for (const relativePath of envRelativePaths) {
    if (known.has(relativePath)) continue;
    known.add(relativePath);
    added.push({ path: relativePath, kind: "file" });
    for (const ancestor of directoryAncestors(relativePath)) {
      if (known.has(ancestor)) continue;
      known.add(ancestor);
      added.push({ path: ancestor, kind: "directory" });
    }
  }
  if (added.length === 0) return entries;
  return [...entries, ...added].toSorted((left, right) => left.path.localeCompare(right.path));
}

/**
 * Walk `root` for env files, breadth-first so the shallowest — and most
 * useful — ones survive the directory budget. Unreadable directories are
 * skipped rather than failing the listing: a browsable workspace missing one
 * permission-denied subtree beats no listing at all.
 */
export const scanEnvFiles = Effect.fn("EnvFileEntries.scanEnvFiles")(function* (root: string) {
  const found: Array<string> = [];
  let queue: Array<{ readonly absolutePath: string; readonly relativePath: string }> = [
    { absolutePath: root, relativePath: "" },
  ];
  let visitedDirectories = 0;
  let truncated = false;

  for (let depth = 0; depth <= MAX_DEPTH && queue.length > 0; depth += 1) {
    const next: Array<{ readonly absolutePath: string; readonly relativePath: string }> = [];
    for (const directory of queue) {
      if (visitedDirectories >= MAX_DIRECTORIES) {
        truncated = true;
        break;
      }
      visitedDirectories += 1;
      const dirents = yield* Effect.tryPromise(() =>
        NodeFSP.readdir(directory.absolutePath, { withFileTypes: true }),
      ).pipe(Effect.orElseSucceed(() => []));

      for (const dirent of dirents) {
        const relativePath =
          directory.relativePath === "" ? dirent.name : `${directory.relativePath}/${dirent.name}`;
        if (dirent.isDirectory()) {
          if (shouldEnterDirectory(dirent.name)) {
            next.push({
              absolutePath: `${directory.absolutePath}/${dirent.name}`,
              relativePath,
            });
          }
          continue;
        }
        if (isEnvFileName(dirent.name)) found.push(relativePath);
      }
    }
    if (visitedDirectories >= MAX_DIRECTORIES && next.length > 0) truncated = true;
    queue = next;
  }
  if (queue.length > 0) truncated = true;

  if (truncated) {
    yield* Effect.logDebug("Env file scan stopped at its bounds", {
      root,
      visitedDirectories,
      maxDepth: MAX_DEPTH,
      found: found.length,
    });
  }

  return found;
});
