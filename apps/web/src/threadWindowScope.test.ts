import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterThreadsInWindowScope,
  isThreadInWindowScope,
  scopeIncludesEveryThread,
  toThreadWindowScope,
} from "./threadWindowScope";

function thread(environmentId: string, id: string) {
  return { environmentId: environmentId as EnvironmentId, id: id as ThreadId };
}

const threads = [thread("local", "a"), thread("local", "b"), thread("remote", "a")];

describe("thread window scope", () => {
  it("shows everything in a window nothing was torn out of", () => {
    const scope = toThreadWindowScope({ kind: "all", hiddenThreadKeys: [] });

    expect(scopeIncludesEveryThread(scope)).toBe(true);
    // Identity-stable so downstream memos are not invalidated every render.
    expect(filterThreadsInWindowScope(threads, scope)).toBe(threads);
  });

  it("hides chats that moved into another window", () => {
    const scope = toThreadWindowScope({ kind: "all", hiddenThreadKeys: ["local:b"] });

    expect(isThreadInWindowScope("local:a", scope)).toBe(true);
    expect(isThreadInWindowScope("local:b", scope)).toBe(false);
    expect(filterThreadsInWindowScope(threads, scope)).toEqual([
      thread("local", "a"),
      thread("remote", "a"),
    ]);
  });

  it("shows only its own chats in a torn-off window", () => {
    const scope = toThreadWindowScope({ kind: "only", threadKeys: ["local:b"] });

    expect(isThreadInWindowScope("local:b", scope)).toBe(true);
    expect(isThreadInWindowScope("local:a", scope)).toBe(false);
    expect(scopeIncludesEveryThread(scope)).toBe(false);
    expect(filterThreadsInWindowScope(threads, scope)).toEqual([thread("local", "b")]);
  });

  it("distinguishes chats that share an id across environments", () => {
    const scope = toThreadWindowScope({ kind: "only", threadKeys: ["remote:a"] });

    expect(filterThreadsInWindowScope(threads, scope)).toEqual([thread("remote", "a")]);
  });
});
