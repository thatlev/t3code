/**
 * Which chats belong to this window.
 *
 * On the desktop a chat can be torn off into its own window, and it *moves*
 * rather than being mirrored: the window it came from stops listing it. The
 * main process owns the assignment (it is the only thing that can see every
 * window) and pushes each window its scope; this store is the renderer's copy.
 *
 * Web builds, and desktop windows nobody has torn anything out of, sit in the
 * default "everything" scope, where every helper here is a pass-through.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { DesktopThreadWindowScope, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";
import { create } from "zustand";

export type ThreadWindowScope =
  | { readonly kind: "all"; readonly hiddenThreadKeys: ReadonlySet<string> }
  | { readonly kind: "only"; readonly threadKeys: ReadonlySet<string> };

const EVERY_THREAD: ThreadWindowScope = { kind: "all", hiddenThreadKeys: new Set() };

export function toThreadWindowScope(scope: DesktopThreadWindowScope): ThreadWindowScope {
  return scope.kind === "only"
    ? { kind: "only", threadKeys: new Set(scope.threadKeys) }
    : { kind: "all", hiddenThreadKeys: new Set(scope.hiddenThreadKeys) };
}

export function isThreadInWindowScope(threadKey: string, scope: ThreadWindowScope): boolean {
  return scope.kind === "only"
    ? scope.threadKeys.has(threadKey)
    : !scope.hiddenThreadKeys.has(threadKey);
}

/** True when the scope excludes nothing, so filtering can be skipped entirely. */
export function scopeIncludesEveryThread(scope: ThreadWindowScope): boolean {
  return scope.kind === "all" && scope.hiddenThreadKeys.size === 0;
}

interface ThreadWindowScopeStore {
  scope: ThreadWindowScope;
  setScope: (scope: DesktopThreadWindowScope) => void;
}

function readInitialScope(): ThreadWindowScope {
  if (typeof window === "undefined") return EVERY_THREAD;
  const initial = window.desktopBridge?.getInitialThreadWindowScope?.();
  return initial == null ? EVERY_THREAD : toThreadWindowScope(initial);
}

export const useThreadWindowScopeStore = create<ThreadWindowScopeStore>((set) => ({
  // Read synchronously from the preload so a torn-off window never paints the
  // full chat list on its first frame.
  scope: readInitialScope(),
  setScope: (scope) => {
    set({ scope: toThreadWindowScope(scope) });
  },
}));

if (typeof window !== "undefined") {
  // One subscription per window, for the lifetime of the window: the main
  // process is the source of truth and pushes on every reassignment.
  window.desktopBridge?.onThreadWindowScopeChange?.((scope) => {
    useThreadWindowScopeStore.getState().setScope(scope);
  });
}

/** Tells the desktop shell this window is now showing a chat, moving it here. */
export function claimThreadForThisWindow(threadKey: string): void {
  window.desktopBridge?.claimThreadWindow?.(threadKey);
}

/**
 * Opens a chat wherever it lives, rather than dragging it into this window.
 *
 * Used by anything that targets a chat by identity instead of by what the user
 * is looking at — the Codex Micro pad's pinned keys, deep links. Navigating
 * directly would *move* the chat here, which for a torn-off chat means the
 * window it lives in loses it and closes. Resolves true when another window
 * took it; false means this window should navigate itself.
 */
export async function focusThreadInOwningWindow(threadKey: string): Promise<boolean> {
  const focusThreadWindow = window.desktopBridge?.focusThreadWindow;
  if (focusThreadWindow === undefined) return false;
  try {
    return await focusThreadWindow(threadKey);
  } catch {
    return false;
  }
}

export function onThreadWindowFocus(listener: (threadKey: string) => void): () => void {
  return window.desktopBridge?.onThreadWindowFocus?.(listener) ?? (() => undefined);
}

export function useThreadWindowScope(): ThreadWindowScope {
  return useThreadWindowScopeStore((store) => store.scope);
}

export function useIsThreadInWindowScope(threadKey: string | null): boolean {
  const scope = useThreadWindowScope();
  return threadKey === null || isThreadInWindowScope(threadKey, scope);
}

export function filterThreadsInWindowScope<
  T extends { readonly environmentId: EnvironmentId; readonly id: ThreadId },
>(threads: ReadonlyArray<T>, scope: ThreadWindowScope): ReadonlyArray<T> {
  // Identity-stable in the common case so downstream memos keep their caches.
  if (scopeIncludesEveryThread(scope)) return threads;
  return threads.filter((thread) =>
    isThreadInWindowScope(
      scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
      scope,
    ),
  );
}

export function useThreadsInWindowScope<
  T extends { readonly environmentId: EnvironmentId; readonly id: ThreadId },
>(threads: ReadonlyArray<T>): ReadonlyArray<T> {
  const scope = useThreadWindowScope();
  return useMemo(() => filterThreadsInWindowScope(threads, scope), [scope, threads]);
}
