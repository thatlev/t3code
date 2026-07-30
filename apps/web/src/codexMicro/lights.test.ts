import { describe, expect, it } from "vite-plus/test";

import { slotForStatus, statusForThread } from "./lights";

describe("Codex Micro agent lights", () => {
  it("preserves every actionable status color when selected", () => {
    expect(slotForStatus(0, "working", true).c).toBe(0x304ffe);
    expect(slotForStatus(1, "needs_input", true).c).toBe(0xff8f00);
    expect(slotForStatus(2, "error", true).c).toBe(0xff0033);
  });

  it("breathes on the selected chat in every status", () => {
    for (const status of ["idle", "working", "complete", "needs_input", "error"] as const) {
      expect(slotForStatus(0, status, true).e).toBe(4);
      expect(slotForStatus(0, status, true).s).toBe(0.4);
    }
  });

  it("never breathes on a chat you are not in, including one working in the background", () => {
    for (const status of ["idle", "working", "complete", "needs_input", "error"] as const) {
      expect(slotForStatus(0, status, false).e).toBe(1);
      expect(slotForStatus(0, status, false).s).toBe(0);
    }
  });

  it("shows an unread completion green and acknowledges it as white", () => {
    expect(slotForStatus(0, "complete", false).c).toBe(0x00ff4c);
    expect(slotForStatus(0, "complete", true).c).toBe(0xffffff);
  });

  it("only reports completed work as green while its completion is unread", () => {
    const thread = {
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      latestTurn: {
        state: "completed",
        completedAt: "2026-07-25T15:00:00.000Z",
      },
    };

    expect(statusForThread(thread, "2026-07-25T14:59:59.000Z")).toBe("complete");
    expect(statusForThread(thread, "2026-07-25T15:00:00.000Z")).toBe("idle");
    expect(statusForThread(thread, undefined)).toBe("idle");
  });
});
