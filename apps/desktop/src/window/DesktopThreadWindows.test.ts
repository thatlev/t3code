import { assert, describe, it } from "@effect/vitest";

import {
  claimThread,
  desktopThreadKey,
  encodeWindowScopeArgument,
  findThreadWindow,
  releaseThreadWindow,
  resolveThreadWindowScope,
  trackThreadWindow,
  type ThreadWindowAssignments,
} from "./DesktopThreadWindows.ts";

const MAIN = 1;
const TORN_OFF = 2;
const OTHER_TORN_OFF = 3;

function assignments(
  entries: ReadonlyArray<readonly [number, readonly string[]]>,
): ThreadWindowAssignments {
  return new Map(entries.map(([id, keys]) => [id, new Set(keys)]));
}

describe("thread window ownership", () => {
  it("builds the same thread key the renderer uses", () => {
    assert.strictEqual(
      desktopThreadKey({ environmentId: "local", threadId: "thr_1" }),
      "local:thr_1",
    );
  });

  it("moves a chat out of the window it was torn off", () => {
    const torn = trackThreadWindow(assignments([]), {
      webContentsId: TORN_OFF,
      threadKey: "local:a",
    });

    assert.deepEqual(resolveThreadWindowScope(torn.assignments, TORN_OFF), {
      kind: "only",
      threadKeys: ["local:a"],
    });
    // The catch-all window keeps every other chat and drops only this one.
    assert.deepEqual(resolveThreadWindowScope(torn.assignments, MAIN), {
      kind: "all",
      hiddenThreadKeys: ["local:a"],
    });
    assert.deepEqual(torn.emptiedWebContentsIds, []);
  });

  it("hands a chat over when another window opens it", () => {
    const start = assignments([
      [TORN_OFF, ["local:a", "local:b"]],
      [OTHER_TORN_OFF, ["local:c"]],
    ]);

    const moved = claimThread(start, { webContentsId: OTHER_TORN_OFF, threadKey: "local:a" });

    assert.deepEqual(resolveThreadWindowScope(moved.assignments, OTHER_TORN_OFF), {
      kind: "only",
      threadKeys: ["local:c", "local:a"],
    });
    assert.deepEqual(resolveThreadWindowScope(moved.assignments, TORN_OFF), {
      kind: "only",
      threadKeys: ["local:b"],
    });
    assert.deepEqual(moved.emptiedWebContentsIds, []);
  });

  it("reports a torn-off window whose last chat moved away", () => {
    const start = assignments([[TORN_OFF, ["local:a"]]]);

    const reclaimed = claimThread(start, { webContentsId: MAIN, threadKey: "local:a" });

    assert.deepEqual(reclaimed.emptiedWebContentsIds, [TORN_OFF]);
    // Back to the catch-all window, hidden from nobody.
    assert.deepEqual(resolveThreadWindowScope(reclaimed.assignments, MAIN), {
      kind: "all",
      hiddenThreadKeys: [],
    });
  });

  it("returns a closed window's chats to the catch-all window", () => {
    const start = assignments([[TORN_OFF, ["local:a", "local:b"]]]);

    const released = releaseThreadWindow(start, TORN_OFF);

    assert.deepEqual(resolveThreadWindowScope(released, MAIN), {
      kind: "all",
      hiddenThreadKeys: [],
    });
    assert.strictEqual(findThreadWindow(released, "local:a"), null);
  });

  it("leaves assignments untouched when an unknown window is released", () => {
    const start = assignments([[TORN_OFF, ["local:a"]]]);
    assert.strictEqual(releaseThreadWindow(start, OTHER_TORN_OFF), start);
  });

  it("finds the window holding a chat", () => {
    const start = assignments([
      [TORN_OFF, ["local:a"]],
      [OTHER_TORN_OFF, ["local:b"]],
    ]);

    assert.strictEqual(findThreadWindow(start, "local:b"), OTHER_TORN_OFF);
    assert.strictEqual(findThreadWindow(start, "local:missing"), null);
  });

  it("encodes an opening scope the preload can read back", () => {
    const argument = encodeWindowScopeArgument({ kind: "only", threadKeys: ["local:a"] });

    assert.isTrue(argument.startsWith("--t3-window-scope="));
    assert.deepEqual(JSON.parse(argument.slice("--t3-window-scope=".length)), {
      kind: "only",
      threadKeys: ["local:a"],
    });
  });
});
