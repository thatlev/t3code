import type { DesktopThreadWindowScope } from "@t3tools/contracts";

import * as Electron from "electron";

import {
  THREAD_WINDOW_FOCUS_CHANNEL,
  THREAD_WINDOW_SCOPE_CHANNEL,
  WINDOW_SCOPE_ARGUMENT_PREFIX,
} from "../ipc/channels.ts";

/**
 * Which window a chat lives in.
 *
 * A chat belongs to exactly one window, the way a tab belongs to exactly one
 * browser window: tearing one off *moves* it, it does not mirror it. Only
 * torn-off windows are tracked here — the window that is not in the registry is
 * the catch-all, and shows every chat nobody else has claimed. That keeps the
 * common case (one window, nothing claimed) free of bookkeeping.
 *
 * This is deliberately a plain module rather than an Effect service: window
 * ownership is process-global Electron state that has to be readable from
 * `main.ts`'s deep-link dispatch, which runs outside the app runtime.
 */

/** Mirrors the renderer's `scopedThreadKey` (client-runtime/environment). */
export function desktopThreadKey(ref: {
  readonly environmentId: string;
  readonly threadId: string;
}): string {
  return `${ref.environmentId}:${ref.threadId}`;
}

export function encodeWindowScopeArgument(scope: DesktopThreadWindowScope): string {
  return `${WINDOW_SCOPE_ARGUMENT_PREFIX}${JSON.stringify(scope)}`;
}

/** Keyed by renderer `webContents.id`, which is what IPC events report. */
export type ThreadWindowAssignments = ReadonlyMap<number, ReadonlySet<string>>;

export interface ThreadClaimResult {
  readonly assignments: ThreadWindowAssignments;
  /**
   * Torn-off windows whose last chat moved elsewhere. They have nothing left to
   * show, so the caller closes them — the same as dragging a browser window's
   * last tab away.
   */
  readonly emptiedWebContentsIds: readonly number[];
}

/**
 * Moves a chat into `webContentsId`. An untracked window is the catch-all, so
 * claiming there simply releases the chat from whichever window held it.
 */
export function claimThread(
  assignments: ThreadWindowAssignments,
  input: { readonly webContentsId: number; readonly threadKey: string },
): ThreadClaimResult {
  const next = new Map<number, ReadonlySet<string>>();
  const emptiedWebContentsIds: number[] = [];

  for (const [webContentsId, threadKeys] of assignments) {
    if (webContentsId === input.webContentsId) {
      next.set(webContentsId, new Set([...threadKeys, input.threadKey]));
      continue;
    }
    if (!threadKeys.has(input.threadKey)) {
      next.set(webContentsId, threadKeys);
      continue;
    }
    const remaining = new Set(threadKeys);
    remaining.delete(input.threadKey);
    if (remaining.size === 0) {
      emptiedWebContentsIds.push(webContentsId);
      continue;
    }
    next.set(webContentsId, remaining);
  }

  return { assignments: next, emptiedWebContentsIds };
}

export function trackThreadWindow(
  assignments: ThreadWindowAssignments,
  input: { readonly webContentsId: number; readonly threadKey: string },
): ThreadClaimResult {
  const seeded = new Map(assignments);
  seeded.set(input.webContentsId, seeded.get(input.webContentsId) ?? new Set());
  return claimThread(seeded, input);
}

export function releaseThreadWindow(
  assignments: ThreadWindowAssignments,
  webContentsId: number,
): ThreadWindowAssignments {
  if (!assignments.has(webContentsId)) {
    return assignments;
  }
  const next = new Map(assignments);
  next.delete(webContentsId);
  return next;
}

export function resolveThreadWindowScope(
  assignments: ThreadWindowAssignments,
  webContentsId: number,
): DesktopThreadWindowScope {
  const owned = assignments.get(webContentsId);
  if (owned !== undefined) {
    return { kind: "only", threadKeys: [...owned] };
  }
  const hiddenThreadKeys = new Set<string>();
  for (const threadKeys of assignments.values()) {
    for (const threadKey of threadKeys) {
      hiddenThreadKeys.add(threadKey);
    }
  }
  return { kind: "all", hiddenThreadKeys: [...hiddenThreadKeys] };
}

export function findThreadWindow(
  assignments: ThreadWindowAssignments,
  threadKey: string,
): number | null {
  for (const [webContentsId, threadKeys] of assignments) {
    if (threadKeys.has(threadKey)) {
      return webContentsId;
    }
  }
  return null;
}

class DesktopThreadWindowRegistry {
  #assignments: ThreadWindowAssignments = new Map();

  /** Starts tracking a torn-off window, seeded with the chat it was opened for. */
  track(input: { readonly webContentsId: number; readonly threadKey: string }): void {
    this.#apply(trackThreadWindow(this.#assignments, input));
  }

  claim(input: { readonly webContentsId: number; readonly threadKey: string }): void {
    // Windows claim on every navigation, and the overwhelmingly common claim is
    // a no-op (an unclaimed chat opened in the catch-all window). Skipping those
    // keeps navigation from broadcasting a scope update per click.
    const currentOwner = findThreadWindow(this.#assignments, input.threadKey);
    const nextOwner = this.#assignments.has(input.webContentsId) ? input.webContentsId : null;
    if (currentOwner === nextOwner) {
      return;
    }
    this.#apply(claimThread(this.#assignments, input));
  }

  release(webContentsId: number): void {
    const next = releaseThreadWindow(this.#assignments, webContentsId);
    if (next === this.#assignments) {
      return;
    }
    this.#assignments = next;
    this.publish();
  }

  isScopedWindow(webContentsId: number): boolean {
    return this.#assignments.has(webContentsId);
  }

  windowForThread(threadKey: string): Electron.BrowserWindow | null {
    const webContentsId = findThreadWindow(this.#assignments, threadKey);
    return webContentsId === null ? null : findWindowByWebContentsId(webContentsId);
  }

  /**
   * The window holding every chat nobody tore off. Single-window peripherals
   * (the Codex Micro remote) talk to exactly this one, so the pad has one
   * listener and one author of its board instead of one per open window.
   */
  catchAllWindow(): Electron.BrowserWindow | null {
    for (const window of safeAllWindows()) {
      if (!window.isDestroyed() && !this.#assignments.has(window.webContents.id)) {
        return window;
      }
    }
    return null;
  }

  /**
   * Brings the window holding a chat to the front and points it at that chat.
   * Returns false when the caller already holds it, so the caller can just
   * navigate itself.
   */
  focusThread(input: {
    readonly threadKey: string;
    readonly requesterWebContentsId: number;
  }): boolean {
    const owner = this.windowForThread(input.threadKey);
    if (owner === null || owner.webContents.id === input.requesterWebContentsId) {
      return false;
    }
    if (owner.isMinimized()) owner.restore();
    if (!owner.isVisible()) owner.show();
    owner.focus();
    owner.webContents.send(THREAD_WINDOW_FOCUS_CHANNEL, input.threadKey);
    return true;
  }

  scopeFor(webContentsId: number): DesktopThreadWindowScope {
    return resolveThreadWindowScope(this.#assignments, webContentsId);
  }

  /** Pushes every live window its current scope. */
  publish(): void {
    for (const window of safeAllWindows()) {
      this.publishTo(window);
    }
  }

  publishTo(window: Electron.BrowserWindow): void {
    if (window.isDestroyed()) {
      return;
    }
    window.webContents.send(THREAD_WINDOW_SCOPE_CHANNEL, this.scopeFor(window.webContents.id));
  }

  #apply(result: ThreadClaimResult): void {
    this.#assignments = result.assignments;
    for (const webContentsId of result.emptiedWebContentsIds) {
      findWindowByWebContentsId(webContentsId)?.close();
    }
    this.publish();
  }
}

function safeAllWindows(): readonly Electron.BrowserWindow[] {
  try {
    return Electron.BrowserWindow.getAllWindows();
  } catch {
    return [];
  }
}

function findWindowByWebContentsId(webContentsId: number): Electron.BrowserWindow | null {
  for (const window of safeAllWindows()) {
    if (!window.isDestroyed() && window.webContents.id === webContentsId) {
      return window;
    }
  }
  return null;
}

export const desktopThreadWindows = new DesktopThreadWindowRegistry();
