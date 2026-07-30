export type CodexMicroThreadStatus = "idle" | "working" | "complete" | "needs_input" | "error";

type ThreadStatusInput = {
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly latestTurn: {
    readonly state: string;
    readonly completedAt: string | null;
  } | null;
};

export function statusForThread(
  thread: ThreadStatusInput,
  lastVisitedAt: string | undefined,
): CodexMicroThreadStatus {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "needs_input";
  if (thread.latestTurn?.state === "running") return "working";
  if (thread.latestTurn?.state === "error") return "error";
  if (thread.latestTurn?.state !== "completed" || !thread.latestTurn.completedAt) return "idle";

  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt) || lastVisitedAt === undefined) return "idle";
  const visitedAt = Date.parse(lastVisitedAt);
  return Number.isNaN(visitedAt) || completedAt > visitedAt ? "complete" : "idle";
}

/**
 * Breathing marks the chat you are in — and nothing else. The selected key
 * always breathes, in whatever colour its status says; every other key stays
 * solid, including a chat working in the background. A moving light on the
 * board therefore always means "this chat, right now".
 *
 * Effects: 1 = solid, 4 = breath.
 */
function light(id: number, c: number, status: string, selected: boolean) {
  return selected ? { id, c, b: 1, e: 4, s: 0.4, status } : { id, c, b: 1, e: 1, s: 0, status };
}

export function slotForStatus(id: number, status: CodexMicroThreadStatus, selected: boolean) {
  switch (status) {
    case "working":
      return light(id, 0x304ffe, status, selected);
    case "needs_input":
      return light(id, 0xff8f00, status, selected);
    case "error":
      return light(id, 0xff0033, status, selected);
    case "complete":
      // Opening an unread completion acknowledges it: green (unread) becomes
      // the ordinary selected white rather than staying "look at me".
      return selected ? light(id, 0xffffff, "selected", true) : light(id, 0x00ff4c, status, false);
    case "idle":
      return light(id, 0xffffff, selected ? "selected" : "idle", selected);
  }
}
