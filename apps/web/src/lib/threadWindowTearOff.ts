import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";

/**
 * Tearing a chat out of the sidebar into its own desktop window, the way a
 * browser tab detaches when you drag it off the tab strip.
 *
 * The gesture is a plain HTML5 drag. There is no drop target for it anywhere in
 * the app, so a release always reports `dropEffect === "none"` — the only thing
 * that distinguishes "let go over my own window" from "let go over the desktop"
 * is where the pointer was. That check lives here rather than in the main
 * process because only the renderer knows its own window rectangle.
 */

// Custom type only: no text/plain, so no in-app text field (the composer,
// a rename input) ever accepts the drag and quietly swallows the tear-off.
const THREAD_TEAR_OFF_MIME = "application/x-t3-thread";

// A release within this many pixels of the window edge counts as inside. The
// pointer position and the window rectangle come from different sources, so a
// drop right on the frame can land a pixel or two either side of it; erring
// toward "inside" means an ambiguous release does nothing instead of spawning
// a window the user did not ask for.
const WINDOW_EDGE_TOLERANCE_PX = 8;

// Only one native drag can be in flight at a time, so the thread being dragged
// is module state. Reading it back off the event is not an option: dragend
// exposes the payload in protected mode, where getData returns "".
let draggingThreadRef: ScopedThreadRef | null = null;

// The preload bridge is installed before any app code runs, so this is stable
// for the lifetime of the window.
export const isThreadTearOffSupported =
  typeof window !== "undefined" && window.desktopBridge?.openThreadWindow !== undefined;

export interface WindowScreenRect {
  readonly screenX: number;
  readonly screenY: number;
  readonly outerWidth: number;
  readonly outerHeight: number;
}

export function isPointOutsideWindow(
  point: { readonly x: number; readonly y: number },
  rect: WindowScreenRect,
): boolean {
  const left = rect.screenX - WINDOW_EDGE_TOLERANCE_PX;
  const top = rect.screenY - WINDOW_EDGE_TOLERANCE_PX;
  const right = rect.screenX + rect.outerWidth + WINDOW_EDGE_TOLERANCE_PX;
  const bottom = rect.screenY + rect.outerHeight + WINDOW_EDGE_TOLERANCE_PX;
  return point.x < left || point.x > right || point.y < top || point.y > bottom;
}

export function handleThreadTearOffDragStart(
  event: React.DragEvent,
  input: { readonly threadRef: ScopedThreadRef },
): void {
  draggingThreadRef = null;
  if (!isThreadTearOffSupported) return;
  // A drag that begins inside a control belongs to that control (selecting
  // text in the rename input, dragging a PR link out to the browser).
  if ((event.target as HTMLElement | null)?.closest("input, textarea, a") != null) return;
  const transfer = event.dataTransfer;
  if (transfer === null) return;

  draggingThreadRef = input.threadRef;
  transfer.effectAllowed = "move";
  // Chromium cancels a drag that carries no data at all.
  transfer.setData(THREAD_TEAR_OFF_MIME, scopedThreadKey(input.threadRef));
}

export function handleThreadTearOffDragEnd(event: React.DragEvent): void {
  const threadRef = draggingThreadRef;
  draggingThreadRef = null;
  const openThreadWindow = window.desktopBridge?.openThreadWindow;
  if (threadRef === null || openThreadWindow === undefined) return;
  // Something in the page accepted the drop; it, not us, owns the outcome.
  if (event.dataTransfer?.dropEffect !== "none") return;
  // Chromium reports the origin when it cannot resolve where a drag ended.
  // Treat that as unknown rather than as a drop in the screen's top-left.
  if (event.screenX === 0 && event.screenY === 0) return;
  const anchor = { x: event.screenX, y: event.screenY };
  if (!isPointOutsideWindow(anchor, window)) return;

  void openThreadWindow({
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    anchor,
    // The new window matches the one it was torn off, so a chat looks the same
    // after it moves.
    size: { width: window.outerWidth, height: window.outerHeight },
  });
}
