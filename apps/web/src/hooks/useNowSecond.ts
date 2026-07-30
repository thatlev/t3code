import { useSyncExternalStore } from "react";

/** Second-quantized wall clock for live "working for Xs" labels.
    One module-level timer feeds every consumer through useSyncExternalStore,
    so N working threads cost one timer instead of N. The timer stops while the
    document is hidden — an occluded or backgrounded window has nothing to
    repaint, and a stopped timer lets the CPU reach deeper idle states instead
    of being woken once a second per visible row. Becoming visible re-reads the
    clock immediately, so a label is never stale once it can be seen. */

function currentSecond(): number {
  return Math.floor(Date.now() / 1_000);
}

let nowSecond = currentSecond();
let timerId: number | null = null;
const listeners = new Set<() => void>();

function tick(): void {
  const next = currentSecond();
  if (next !== nowSecond) {
    nowSecond = next;
    for (const listener of listeners) listener();
  }
}

function stopTimer(): void {
  if (timerId === null) return;
  window.clearInterval(timerId);
  timerId = null;
}

function startTimer(): void {
  if (timerId !== null || listeners.size === 0) return;
  if (typeof document !== "undefined" && document.hidden) return;
  timerId = window.setInterval(tick, 2_000);
}

function onVisibilityChange(): void {
  if (document.hidden) {
    stopTimer();
    return;
  }
  // Catch up on everything missed while hidden before resuming the cadence.
  tick();
  startTimer();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  listeners.add(listener);
  startTimer();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopTimer();
    }
  };
}

function getSnapshot(): number {
  // With no timer running (no subscribers yet, or the document is hidden) the
  // stored second is stale, so re-read it. While the timer runs the cached
  // value is returned untouched, as useSyncExternalStore requires between
  // change notifications.
  if (timerId === null) {
    nowSecond = currentSecond();
  }
  return nowSecond;
}

/** Epoch seconds, updated at most once every two seconds while the document is visible. */
export function useNowSecond(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
