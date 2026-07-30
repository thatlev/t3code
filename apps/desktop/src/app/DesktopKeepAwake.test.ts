import { describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeController, type KeepAwakeProcess } from "./DesktopKeepAwake.ts";

function fakeProcess() {
  const listeners = new Map<string, () => void>();
  return {
    pid: 42,
    killed: false,
    kill: vi.fn(function (this: { killed: boolean }) {
      this.killed = true;
      return true;
    }),
    once: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
    }),
  } satisfies KeepAwakeProcess;
}

describe("DesktopKeepAwake", () => {
  it.effect("starts one caffeinate process and stops it", () =>
    Effect.gen(function* () {
      const child = fakeProcess();
      const spawn = vi.fn(() => child);
      const controller = yield* makeController("darwin", spawn);

      expect(yield* controller.reconcile(true)).toBe(true);
      expect(yield* controller.reconcile(true)).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(yield* controller.reconcile(false)).toBe(false);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    }),
  );

  it.effect("is a no-op on unsupported platforms", () =>
    Effect.gen(function* () {
      const spawn = vi.fn(() => fakeProcess());
      const controller = yield* makeController("linux", spawn);
      expect(yield* controller.reconcile(true)).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    }),
  );
});
