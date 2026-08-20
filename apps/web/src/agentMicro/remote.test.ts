import { describe, expect, it } from "vite-plus/test";

import {
  buildWorkspaceStateFrame,
  isRedundantWorkspaceStateFrame,
  type AgentMicroWorkspaceState,
} from "./remote";

function makeState(patch: Partial<AgentMicroWorkspaceState> = {}): AgentMicroWorkspaceState {
  return {
    type: "workspace-state",
    version: 2,
    surface: "t3code",
    connected: true,
    lightingBrightness: 0.8,
    autoDimSeconds: 30,
    targets: [
      {
        id: "env|thread-1",
        kind: "t3",
        label: "Thread one",
        provider: "t3",
        active: true,
        nativeVoice: false,
      },
    ],
    projects: [{ id: "env|project-1", title: "Project one" }],
    pins: ["env|thread-1", null, null, null, null, null],
    selected: "env|thread-1",
    nativeVoiceActive: false,
    slots: [{ id: 0, c: 0xffffff, b: 1, e: 1, s: 0, status: "idle" }],
    controls: {
      actionKeys: [{ key: "ACT06", action: "fast", label: "FAST", symbol: "bolt.fill", accent: 1 }],
      joystick: { up: "new", right: "pin", down: "clear", left: "send" },
    },
    ...patch,
  };
}

describe("codex micro workspace-state frames", () => {
  it("sends everything when the phone has no retained state", () => {
    const state = makeState();
    const frame = buildWorkspaceStateFrame(state, null);
    expect(frame).toEqual({ ...state, nativeVoiceActive: false });
    expect(isRedundantWorkspaceStateFrame(frame, null)).toBe(false);
  });

  it("sends only the lights when only the lights changed", () => {
    const previous = makeState();
    const next = makeState({
      slots: [{ id: 0, c: 0x304fff, b: 1, e: 4, s: 0.4, status: "working" }],
    });

    const frame = buildWorkspaceStateFrame(next, previous);

    expect(Object.keys(frame).toSorted()).toEqual([
      "connected",
      "nativeVoiceActive",
      "selected",
      "slots",
      "surface",
      "type",
      "version",
    ]);
    expect(frame.slots).toEqual(next.slots);
    // The thread and project lists are what make a full frame kilobytes long.
    expect(frame).not.toHaveProperty("targets");
    expect(frame).not.toHaveProperty("projects");
    expect(frame).not.toHaveProperty("controls");
  });

  it("always restates the fields the phone replaces rather than merges", () => {
    const previous = makeState();
    const { selected: _dropped, ...next } = makeState({
      connected: false,
      issue: "Disconnected",
    });

    const frame = buildWorkspaceStateFrame(next, previous);

    // An absent `connected` reads as disconnected on the phone and an absent
    // `selected` as no selection, so both must travel in every frame.
    expect(frame.connected).toBe(false);
    expect(frame).not.toHaveProperty("selected");
    expect(frame.issue).toBe("Disconnected");
    expect(frame.nativeVoiceActive).toBe(false);
  });

  it("treats an unchanged state as a frame not worth sending", () => {
    const previous = makeState();
    const frame = buildWorkspaceStateFrame(makeState(), previous);
    expect(isRedundantWorkspaceStateFrame(frame, previous)).toBe(true);
  });

  it("still sends when only a replace-always field changed", () => {
    const previous = makeState();
    const frame = buildWorkspaceStateFrame(makeState({ nativeVoiceActive: true }), previous);
    expect(isRedundantWorkspaceStateFrame(frame, previous)).toBe(false);
  });
});
