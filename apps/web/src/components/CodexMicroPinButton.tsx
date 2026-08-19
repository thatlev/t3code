import { PinIcon } from "lucide-react";
import type { MouseEvent, PointerEvent } from "react";

import {
  encodeCodexMicroTarget,
  toggleCodexMicroPin,
  useCodexMicroIsPinned,
} from "../codexMicro/pins";
import { cn } from "../lib/utils";

type CodexMicroPinButtonProps = {
  readonly environmentId: string;
  readonly threadId: string;
  readonly hoverGroup: "sidebar" | "sidebar-v2" | "sidebar-row";
};

export function CodexMicroPinButton({
  environmentId,
  threadId,
  hoverGroup,
}: CodexMicroPinButtonProps) {
  const isPinned = useCodexMicroIsPinned(environmentId, threadId);
  const label = isPinned ? "Unpin thread from AgentMicro" : "Pin thread to AgentMicro";
  const revealClassName =
    hoverGroup === "sidebar-v2"
      ? "group-hover/v2-row:pointer-events-auto group-hover/v2-row:opacity-100 group-focus-within/v2-row:pointer-events-auto group-focus-within/v2-row:opacity-100"
      : hoverGroup === "sidebar-row"
        ? "group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100 group-focus-within/sidebar-row:pointer-events-auto group-focus-within/sidebar-row:opacity-100"
        : "group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100";

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    toggleCodexMicroPin(encodeCodexMicroTarget(environmentId, threadId));
  };
  const handleDoubleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  // Every row reserves the same leading slot whether pinned or not. The
  // hover-revealed icon stays fixed in place, while titles always begin far
  // enough to the right that they can never overlap it.
  return (
    <span className="relative size-4 shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-pressed={isPinned}
        title={label}
        data-thread-selection-safe
        data-testid={`thread-pin-${threadId}`}
        className={cn(
          "absolute top-1/2 left-0 inline-flex size-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm outline-hidden transition-[color,opacity] duration-150 motion-reduce:transition-none focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring",
          isPinned
            ? "text-violet-500 opacity-100"
            : cn(
                "pointer-events-none bg-sidebar-row-hover text-muted-foreground/60 opacity-0 hover:text-muted-foreground",
                revealClassName,
              ),
        )}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <PinIcon aria-hidden className="size-3" />
      </button>
    </span>
  );
}
