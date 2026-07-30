import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  applyCodexMicroAutoPins,
  encodeCodexMicroTarget,
  pinCodexMicroTarget,
  readCodexMicroPins,
  reconcileCodexMicroPins,
  requestCodexMicroAutoPin,
  toggleCodexMicroPin,
  unpinCodexMicroTargetForSettlement,
} from "./pins";

function createLocalStorageStub(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createLocalStorageStub());
  vi.stubGlobal("window", new EventTarget());
});

describe("Codex Micro pins", () => {
  it("allows the final pinned chat to be unpinned", () => {
    const target = encodeCodexMicroTarget("local", "thread-1");

    expect(toggleCodexMicroPin(target)).toBe(true);
    expect(toggleCodexMicroPin(target)).toBe(false);
    expect(readCodexMicroPins()).toEqual([null, null, null, null, null, null]);
  });

  it("temporarily unpins a settled chat and restores it when un-settled", () => {
    const target = encodeCodexMicroTarget("local", "thread-settlement");
    expect(pinCodexMicroTarget("local", "thread-settlement")).toBe(true);

    expect(unpinCodexMicroTargetForSettlement("local", "thread-settlement")).toBe(true);
    expect(readCodexMicroPins()).toEqual([null, null, null, null, null, null]);

    expect(pinCodexMicroTarget("local", "thread-settlement")).toBe(true);
    expect(readCodexMicroPins()).toEqual([target, null, null, null, null, null]);
  });

  it("keeps an intentionally empty layout empty during reconciliation", () => {
    const target = encodeCodexMicroTarget("local", "thread-1");

    expect(
      reconcileCodexMicroPins([null, null, null, null, null, null], new Set([target])),
    ).toEqual([null, null, null, null, null, null]);
  });

  it("keeps pins for transiently missing threads and drops only archived ones", () => {
    const kept = encodeCodexMicroTarget("local", "thread-missing");
    const archived = encodeCodexMicroTarget("local", "thread-archived");

    expect(
      reconcileCodexMicroPins([kept, archived, null, null, null, null], new Set([archived])),
    ).toEqual([kept, null, null, null, null, null]);
  });

  it("auto-pins a new chat once without disturbing existing pins", () => {
    const first = encodeCodexMicroTarget("local", "thread-1");
    const second = encodeCodexMicroTarget("local", "thread-2");
    toggleCodexMicroPin(first);

    expect(pinCodexMicroTarget("local", "thread-2")).toBe(true);
    expect(pinCodexMicroTarget("local", "thread-2")).toBe(true);
    expect(readCodexMicroPins()).toEqual([first, second, null, null, null, null]);
  });

  it("waits to auto-pin until the new chat is available", () => {
    const target = encodeCodexMicroTarget("local", "thread-1");
    const emptyPins = [null, null, null, null, null, null];

    expect(applyCodexMicroAutoPins(emptyPins, [target], new Set())).toEqual({
      pins: emptyPins,
      handledTargets: [],
    });
    expect(applyCodexMicroAutoPins(emptyPins, [target], new Set([target]))).toEqual({
      pins: [target, null, null, null, null, null],
      handledTargets: [target],
    });
  });

  it("evicts the oldest pin when auto-pinning onto a full board", () => {
    const pins = ["t-1", "t-2", "t-3", "t-4", "t-5", "t-6"];
    const incoming = "t-7";

    expect(applyCodexMicroAutoPins(pins, [incoming], new Set([incoming]))).toEqual({
      pins: ["t-2", "t-3", "t-4", "t-5", "t-6", "t-7"],
      handledTargets: [incoming],
    });
  });

  it("reads a legacy v1 slot array", () => {
    const target = encodeCodexMicroTarget("local", "thread-legacy");
    localStorage.setItem("t3.codexMicro.pins.v1", JSON.stringify([target]));

    expect(readCodexMicroPins()).toEqual([target, null, null, null, null, null]);
  });

  it("never auto-pins a thread the user unpinned by hand", () => {
    const target = encodeCodexMicroTarget("local", "thread-unpinned");
    expect(toggleCodexMicroPin(target)).toBe(true);
    expect(toggleCodexMicroPin(target)).toBe(false);

    const emptyPins = [null, null, null, null, null, null];
    // The request is still consumed (handled) so it leaves the queue.
    expect(applyCodexMicroAutoPins(emptyPins, [target], new Set([target]))).toEqual({
      pins: emptyPins,
      handledTargets: [target],
    });
  });

  it("drops auto-pin requests for explicitly unpinned threads until manually re-pinned", () => {
    const requested: string[] = [];
    window.addEventListener("t3-codex-micro-auto-pin-requested", (event) => {
      requested.push((event as CustomEvent<string>).detail);
    });
    const target = encodeCodexMicroTarget("local", "thread-request-guard");
    toggleCodexMicroPin(target);
    toggleCodexMicroPin(target);

    requestCodexMicroAutoPin("local", "thread-request-guard");
    expect(requested).toEqual([]);

    // A manual re-pin clears the explicit-unpin record.
    toggleCodexMicroPin(target);
    requestCodexMicroAutoPin("local", "thread-request-guard");
    expect(requested).toEqual([target]);
  });

  it("dedupes repeated auto-pin requests for the same thread", () => {
    const requested: string[] = [];
    window.addEventListener("t3-codex-micro-auto-pin-requested", (event) => {
      requested.push((event as CustomEvent<string>).detail);
    });
    const target = encodeCodexMicroTarget("local", "thread-dedupe");

    requestCodexMicroAutoPin("local", "thread-dedupe");
    requestCodexMicroAutoPin("local", "thread-dedupe");
    expect(requested).toEqual([target]);
  });
});
