import type { DesktopEnvironmentBootstrap } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { readDesktopSecondaryBootstraps } from "./desktopLocal";

const DESKTOP_LOCAL_BOOTSTRAP_POLL_MS = 5_000;

/**
 * Two reads describe the same topology when the same backends are registered
 * with the same identity and endpoints. The reader builds a fresh array on
 * every call, so without this comparison the poll would hand React a new
 * identity each tick and re-render every consumer (the sidebar, the command
 * palette) forever, even on a completely idle window.
 */
function sameTopology(
  left: ReadonlyArray<DesktopEnvironmentBootstrap>,
  right: ReadonlyArray<DesktopEnvironmentBootstrap>,
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index]!;
    return (
      entry.id === other.id &&
      entry.label === other.label &&
      entry.runningDistro === other.runningDistro &&
      entry.httpBaseUrl === other.httpBaseUrl &&
      entry.wsBaseUrl === other.wsBaseUrl &&
      entry.bootstrapToken === other.bootstrapToken
    );
  });
}

/**
 * Reactively track the desktop's secondary local backends (e.g. a parallel WSL
 * backend). The bridge exposes no change event, so we re-read on an interval;
 * failed reads retain the latest successful snapshot, while a successful empty
 * read clears it. Use this instead of polling the bridge ad hoc so every
 * renderer consumer reads the same topology.
 *
 * The read crosses a *synchronous* IPC boundary into the Electron main process,
 * so it is deliberately infrequent and paused while the document is hidden: a
 * backgrounded window has no UI depending on the answer, and the poll would
 * otherwise wake both processes on a wall-clock timer forever.
 */
export function useDesktopLocalBootstraps(): ReadonlyArray<DesktopEnvironmentBootstrap> {
  const [bootstraps, setBootstraps] = useState<ReadonlyArray<DesktopEnvironmentBootstrap>>(
    readDesktopSecondaryBootstraps,
  );

  useEffect(() => {
    let intervalId: number | null = null;
    const read = () =>
      setBootstraps((current) => {
        const next = readDesktopSecondaryBootstraps();
        return sameTopology(current, next) ? current : next;
      });
    const stop = () => {
      if (intervalId === null) return;
      window.clearInterval(intervalId);
      intervalId = null;
    };
    const start = () => {
      if (intervalId !== null || document.hidden) return;
      intervalId = window.setInterval(read, DESKTOP_LOCAL_BOOTSTRAP_POLL_MS);
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
        return;
      }
      // The topology may have changed while nothing was watching it.
      read();
      start();
    };

    read();
    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, []);

  return bootstraps;
}
