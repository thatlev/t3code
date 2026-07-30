import { useMemo, useSyncExternalStore } from "react";

const PINS_STORAGE_KEY = "t3.codexMicro.pins.v1";
const PINS_CHANGE_EVENT = "t3-codex-micro-pins-changed";
const AUTO_PIN_REQUEST_EVENT = "t3-codex-micro-auto-pin-requested";

export const CODEX_MICRO_PIN_SLOT_COUNT = 6;

// A thread the user unpins by hand must never be auto-pinned again: auto-pin
// is a convenience for brand-new chats, not an override of an explicit
// unpin. The record is bounded; only the most recent unpins are remembered.
const EXPLICIT_UNPIN_LIMIT = 100;

type StoredCodexMicroPins = {
  readonly pins: Array<string | null>;
  readonly explicitUnpins: readonly string[];
};

function normalizePins(pins: ReadonlyArray<unknown>): Array<string | null> {
  const compact = pins.filter((pin): pin is string => typeof pin === "string" && pin.length > 0);
  return Array.from({ length: CODEX_MICRO_PIN_SLOT_COUNT }, (_, index) => compact[index] ?? null);
}

function parseStoredPins(value: unknown): StoredCodexMicroPins {
  // v1 stored a bare slot array; v2 wraps it with the explicit-unpin record.
  if (Array.isArray(value)) {
    return { pins: normalizePins(value), explicitUnpins: [] };
  }
  if (value && typeof value === "object") {
    const candidate = value as { pins?: unknown; explicitUnpins?: unknown };
    return {
      pins: normalizePins(Array.isArray(candidate.pins) ? candidate.pins : []),
      explicitUnpins: Array.isArray(candidate.explicitUnpins)
        ? candidate.explicitUnpins.filter(
            (target): target is string => typeof target === "string" && target.length > 0,
          )
        : [],
    };
  }
  return { pins: normalizePins([]), explicitUnpins: [] };
}

function readStoredPins(): StoredCodexMicroPins {
  if (typeof localStorage === "undefined") {
    return { pins: normalizePins([]), explicitUnpins: [] };
  }
  try {
    return parseStoredPins(JSON.parse(localStorage.getItem(PINS_STORAGE_KEY) ?? "null"));
  } catch {
    return { pins: normalizePins([]), explicitUnpins: [] };
  }
}

function writeStoredPins(stored: StoredCodexMicroPins): void {
  localStorage.setItem(PINS_STORAGE_KEY, JSON.stringify({ version: 2, ...stored }));
  window.dispatchEvent(new Event(PINS_CHANGE_EVENT));
}

export function readCodexMicroPins(): Array<string | null> {
  return readStoredPins().pins;
}

export function writeCodexMicroPins(pins: ReadonlyArray<string | null>): void {
  writeStoredPins({ pins: normalizePins(pins), explicitUnpins: readStoredPins().explicitUnpins });
}

export function reconcileCodexMicroPins(
  pins: ReadonlyArray<string | null>,
  archivedTargets: ReadonlySet<string>,
): Array<string | null> {
  // Only a positively archived thread loses its pin here. A thread that is
  // merely absent from the current shell list — its environment is
  // reconnecting or its snapshot is mid-refresh — keeps its pin, so a
  // transient load can never erase the persisted layout. Deleted threads are
  // removed explicitly at the delete site.
  return normalizePins(pins.filter((pin) => pin === null || !archivedTargets.has(pin)));
}

/// Silent pin removal without an explicit-unpin record, for threads that are
/// being deleted. The settlement variant below keeps its own name for the
/// settle/un-settle flow; both share the same "gone but not user-unpinned"
/// semantics.
export function removeCodexMicroPin(environmentId: string, threadId: string): boolean {
  return unpinCodexMicroTargetForSettlement(environmentId, threadId);
}

export function applyCodexMicroAutoPins(
  pins: ReadonlyArray<string | null>,
  requestedTargets: ReadonlyArray<string>,
  availableTargets: ReadonlySet<string>,
): { pins: Array<string | null>; handledTargets: readonly string[] } {
  const nextPins = normalizePins(pins);
  const handledTargets: string[] = [];
  const explicitUnpins = new Set(readStoredPins().explicitUnpins);

  for (const target of requestedTargets) {
    if (!availableTargets.has(target)) continue;
    handledTargets.push(target);
    // Explicitly unpinned threads stay unpinned; the request is still
    // consumed (handled) so it does not linger in the queue forever.
    if (explicitUnpins.has(target)) continue;
    if (nextPins.includes(target)) continue;

    let free = nextPins.indexOf(null);
    if (free < 0) {
      // All six keys are taken. A new chat must still get one: drop the
      // oldest pin (slot order follows insertion order) and append at the
      // end, so the most recent chats always stay on the board.
      nextPins.shift();
      nextPins.push(null);
      free = nextPins.length - 1;
    }
    nextPins[free] = target;
  }

  return { pins: nextPins, handledTargets };
}

function subscribePins(listener: () => void): () => void {
  window.addEventListener(PINS_CHANGE_EVENT, listener);
  return () => window.removeEventListener(PINS_CHANGE_EVENT, listener);
}

export function encodeCodexMicroTarget(environmentId: string, threadId: string): string {
  return `${encodeURIComponent(environmentId)}|${encodeURIComponent(threadId)}`;
}

export function decodeCodexMicroTarget(
  value: string,
): { environmentId: string; threadId: string } | null {
  const separator = value.indexOf("|");
  if (separator < 1 || separator === value.length - 1) return null;
  try {
    return {
      environmentId: decodeURIComponent(value.slice(0, separator)),
      threadId: decodeURIComponent(value.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

function withoutExplicitUnpin(
  explicitUnpins: readonly string[],
  target: string,
): readonly string[] {
  return explicitUnpins.filter((unpinned) => unpinned !== target);
}

function withExplicitUnpin(explicitUnpins: readonly string[], target: string): readonly string[] {
  return [target, ...withoutExplicitUnpin(explicitUnpins, target)].slice(0, EXPLICIT_UNPIN_LIMIT);
}

export function pinCodexMicroTarget(environmentId: string, threadId: string): boolean {
  const target = encodeCodexMicroTarget(environmentId, threadId);
  const stored = readStoredPins();
  const explicitUnpins = withoutExplicitUnpin(stored.explicitUnpins, target);
  if (stored.pins.includes(target)) {
    if (explicitUnpins.length !== stored.explicitUnpins.length) {
      writeStoredPins({ pins: stored.pins, explicitUnpins });
    }
    return true;
  }

  const free = stored.pins.indexOf(null);
  if (free < 0) return false;

  stored.pins[free] = target;
  writeStoredPins({ pins: stored.pins, explicitUnpins });
  return true;
}

/**
 * Settlement temporarily removes a thread from Codex Micro without recording
 * an explicit user unpin. That lets an eventual un-settle restore the pin.
 */
export function unpinCodexMicroTargetForSettlement(
  environmentId: string,
  threadId: string,
): boolean {
  const target = encodeCodexMicroTarget(environmentId, threadId);
  const stored = readStoredPins();
  const existing = stored.pins.indexOf(target);
  if (existing < 0) return false;

  stored.pins[existing] = null;
  writeStoredPins(stored);
  return true;
}

export function toggleCodexMicroPin(target: string): boolean {
  const stored = readStoredPins();
  const pins = stored.pins;
  const existing = pins.indexOf(target);
  if (existing >= 0) {
    pins[existing] = null;
    writeStoredPins({ pins, explicitUnpins: withExplicitUnpin(stored.explicitUnpins, target) });
    return false;
  }

  const free = pins.indexOf(null);
  if (free < 0) return false;

  pins[free] = target;
  writeStoredPins({ pins, explicitUnpins: withoutExplicitUnpin(stored.explicitUnpins, target) });
  return true;
}

// Auto-pin is requested once per thread per session: sends that happen while
// a chat still counts as a local draft must not queue duplicates.
const requestedAutoPinTargets = new Set<string>();

export function requestCodexMicroAutoPin(environmentId: string, threadId: string): void {
  const target = encodeCodexMicroTarget(environmentId, threadId);
  if (requestedAutoPinTargets.has(target)) return;
  // Explicitly unpinned threads never re-request: the record persists
  // across sessions, while the dedupe set only covers this one. Check it
  // before recording the request so a later manual re-pin can re-arm.
  if (readStoredPins().explicitUnpins.includes(target)) return;
  requestedAutoPinTargets.add(target);
  window.dispatchEvent(
    new CustomEvent<string>(AUTO_PIN_REQUEST_EVENT, {
      detail: target,
    }),
  );
}

export function subscribeCodexMicroAutoPinRequests(listener: (target: string) => void): () => void {
  const onRequest = (event: Event) => {
    const target = (event as CustomEvent<unknown>).detail;
    if (typeof target === "string" && target.length > 0) {
      listener(target);
    }
  };
  window.addEventListener(AUTO_PIN_REQUEST_EVENT, onRequest);
  return () => window.removeEventListener(AUTO_PIN_REQUEST_EVENT, onRequest);
}

export function useCodexMicroIsPinned(environmentId: string, threadId: string): boolean {
  const serialized = useSyncExternalStore(
    subscribePins,
    () => localStorage.getItem(PINS_STORAGE_KEY) ?? "null",
    () => "null",
  );
  try {
    return parseStoredPins(JSON.parse(serialized)).pins.includes(
      encodeCodexMicroTarget(environmentId, threadId),
    );
  } catch {
    return false;
  }
}

export function useCodexMicroPinnedTargets(): readonly string[] {
  const serialized = useSyncExternalStore(
    subscribePins,
    () => localStorage.getItem(PINS_STORAGE_KEY) ?? "null",
    () => "null",
  );
  return useMemo(() => {
    try {
      return parseStoredPins(JSON.parse(serialized)).pins.filter(
        (pin): pin is string => pin !== null,
      );
    } catch {
      return [];
    }
  }, [serialized]);
}

export function resetCodexMicroPins(): void {
  localStorage.removeItem(PINS_STORAGE_KEY);
  window.dispatchEvent(new Event(PINS_CHANGE_EVENT));
}
