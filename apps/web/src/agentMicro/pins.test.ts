import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  applyAgentMicroAutoPins,
  encodeAgentMicroTarget,
  pinAgentMicroTarget,
  readAgentMicroPins,
  reconcileAgentMicroPins,
  requestAgentMicroAutoPin,
  toggleAgentMicroPin,
  unpinAgentMicroTargetForSettlement,
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

describe("AgentMicro pins", () => {
  it("allows the final pinned chat to be unpinned", () => {
    const target = encodeAgentMicroTarget("local", "thread-1");

    expect(toggleAgentMicroPin(target)).toBe(true);
    expect(toggleAgentMicroPin(target)).toBe(false);
    expect(readAgentMicroPins()).toEqual([null, null, null, null, null, null]);
  });

  it("temporarily unpins a settled chat and restores it when un-settled", () => {
    const target = encodeAgentMicroTarget("local", "thread-settlement");
    expect(pinAgentMicroTarget("local", "thread-settlement")).toBe(true);

    expect(unpinAgentMicroTargetForSettlement("local", "thread-settlement")).toBe(true);
    expect(readAgentMicroPins()).toEqual([null, null, null, null, null, null]);

    expect(pinAgentMicroTarget("local", "thread-settlement")).toBe(true);
    expect(readAgentMicroPins()).toEqual([target, null, null, null, null, null]);
  });

  it("keeps an intentionally empty layout empty during reconciliation", () => {
    const target = encodeAgentMicroTarget("local", "thread-1");

    expect(
      reconcileAgentMicroPins([null, null, null, null, null, null], new Set([target])),
    ).toEqual([null, null, null, null, null, null]);
  });

  it("keeps pins for transiently missing threads and drops only archived ones", () => {
    const kept = encodeAgentMicroTarget("local", "thread-missing");
    const archived = encodeAgentMicroTarget("local", "thread-archived");

    expect(
      reconcileAgentMicroPins([kept, archived, null, null, null, null], new Set([archived])),
    ).toEqual([kept, null, null, null, null, null]);
  });

  it("auto-pins a new chat once without disturbing existing pins", () => {
    const first = encodeAgentMicroTarget("local", "thread-1");
    const second = encodeAgentMicroTarget("local", "thread-2");
    toggleAgentMicroPin(first);

    expect(pinAgentMicroTarget("local", "thread-2")).toBe(true);
    expect(pinAgentMicroTarget("local", "thread-2")).toBe(true);
    expect(readAgentMicroPins()).toEqual([first, second, null, null, null, null]);
  });

  it("waits to auto-pin until the new chat is available", () => {
    const target = encodeAgentMicroTarget("local", "thread-1");
    const emptyPins = [null, null, null, null, null, null];

    expect(applyAgentMicroAutoPins(emptyPins, [target], new Set())).toEqual({
      pins: emptyPins,
      handledTargets: [],
    });
    expect(applyAgentMicroAutoPins(emptyPins, [target], new Set([target]))).toEqual({
      pins: [target, null, null, null, null, null],
      handledTargets: [target],
    });
  });

  it("evicts the oldest pin when auto-pinning onto a full board", () => {
    const pins = ["t-1", "t-2", "t-3", "t-4", "t-5", "t-6"];
    const incoming = "t-7";

    expect(applyAgentMicroAutoPins(pins, [incoming], new Set([incoming]))).toEqual({
      pins: ["t-2", "t-3", "t-4", "t-5", "t-6", "t-7"],
      handledTargets: [incoming],
    });
  });

  it("reads a legacy v1 slot array", () => {
    const target = encodeAgentMicroTarget("local", "thread-legacy");
    localStorage.setItem("t3.agentMicro.pins.v1", JSON.stringify([target]));

    expect(readAgentMicroPins()).toEqual([target, null, null, null, null, null]);
  });

  it("never auto-pins a thread the user unpinned by hand", () => {
    const target = encodeAgentMicroTarget("local", "thread-unpinned");
    expect(toggleAgentMicroPin(target)).toBe(true);
    expect(toggleAgentMicroPin(target)).toBe(false);

    const emptyPins = [null, null, null, null, null, null];
    // The request is still consumed (handled) so it leaves the queue.
    expect(applyAgentMicroAutoPins(emptyPins, [target], new Set([target]))).toEqual({
      pins: emptyPins,
      handledTargets: [target],
    });
  });

  it("drops auto-pin requests for explicitly unpinned threads until manually re-pinned", () => {
    const requested: string[] = [];
    window.addEventListener("t3-agent-micro-auto-pin-requested", (event) => {
      requested.push((event as CustomEvent<string>).detail);
    });
    const target = encodeAgentMicroTarget("local", "thread-request-guard");
    toggleAgentMicroPin(target);
    toggleAgentMicroPin(target);

    requestAgentMicroAutoPin("local", "thread-request-guard");
    expect(requested).toEqual([]);

    // A manual re-pin clears the explicit-unpin record.
    toggleAgentMicroPin(target);
    requestAgentMicroAutoPin("local", "thread-request-guard");
    expect(requested).toEqual([target]);
  });

  it("dedupes repeated auto-pin requests for the same thread", () => {
    const requested: string[] = [];
    window.addEventListener("t3-agent-micro-auto-pin-requested", (event) => {
      requested.push((event as CustomEvent<string>).detail);
    });
    const target = encodeAgentMicroTarget("local", "thread-dedupe");

    requestAgentMicroAutoPin("local", "thread-dedupe");
    requestAgentMicroAutoPin("local", "thread-dedupe");
    expect(requested).toEqual([target]);
  });
});
