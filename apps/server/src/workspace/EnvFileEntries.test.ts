// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  directoryAncestors,
  isEnvFileName,
  mergeEnvFileEntries,
  scanEnvFiles,
  shouldEnterDirectory,
} from "./EnvFileEntries.ts";

it("recognizes env files and only env files", () => {
  assert.isTrue(isEnvFileName(".env"));
  assert.isTrue(isEnvFileName(".env.local"));
  assert.isTrue(isEnvFileName(".env.production.local"));
  assert.isFalse(isEnvFileName("env"));
  assert.isFalse(isEnvFileName(".environment"));
  assert.isFalse(isEnvFileName("app.env"));
});

it("skips dot-directories and build output", () => {
  assert.isTrue(shouldEnterDirectory("apps"));
  assert.isTrue(shouldEnterDirectory("src"));
  assert.isFalse(shouldEnterDirectory(".git"));
  assert.isFalse(shouldEnterDirectory("node_modules"));
  assert.isFalse(shouldEnterDirectory("dist"));
});

it("lists every directory on a path", () => {
  assert.deepEqual(directoryAncestors("apps/web/.env"), ["apps", "apps/web"]);
  assert.deepEqual(directoryAncestors(".env"), []);
});

it("merges env files without duplicating what the index already has", () => {
  const indexed = [
    { path: "apps", kind: "directory" as const },
    { path: "apps/web", kind: "directory" as const },
    { path: "apps/web/main.ts", kind: "file" as const },
  ];

  const merged = mergeEnvFileEntries(indexed, ["apps/web/.env", "generated/.env.local"]);

  assert.deepEqual(merged, [
    { path: "apps", kind: "directory" },
    { path: "apps/web", kind: "directory" },
    { path: "apps/web/.env", kind: "file" },
    { path: "apps/web/main.ts", kind: "file" },
    // The ignored parent is absent from the index, so it comes along.
    { path: "generated", kind: "directory" },
    { path: "generated/.env.local", kind: "file" },
  ]);
});

it("returns the original entries when there is nothing to add", () => {
  const indexed = [{ path: "apps/web/.env", kind: "file" as const }];
  assert.strictEqual(mergeEnvFileEntries(indexed, []), indexed);
  // An env file the index somehow already carries must not be re-added.
  assert.strictEqual(mergeEnvFileEntries(indexed, ["apps/web/.env"]), indexed);
});

it.effect("finds env files the workspace index hides", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-env-scan-")),
    );

    yield* Effect.promise(async () => {
      await NodeFSP.mkdir(NodePath.join(root, "apps/web"), { recursive: true });
      await NodeFSP.mkdir(NodePath.join(root, "node_modules/pkg"), { recursive: true });
      await NodeFSP.mkdir(NodePath.join(root, ".git"), { recursive: true });
      await NodeFSP.writeFile(NodePath.join(root, ".env"), "ROOT=1\n");
      await NodeFSP.writeFile(NodePath.join(root, "apps/web/.env.local"), "WEB=1\n");
      await NodeFSP.writeFile(NodePath.join(root, "apps/web/main.ts"), "export {};\n");
      await NodeFSP.writeFile(NodePath.join(root, "node_modules/pkg/.env"), "DEP=1\n");
      await NodeFSP.writeFile(NodePath.join(root, ".git/.env"), "GIT=1\n");
    });

    const found = yield* scanEnvFiles(root);

    assert.deepEqual(found.toSorted(), [".env", "apps/web/.env.local"]);

    yield* Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true }));
  }),
);
