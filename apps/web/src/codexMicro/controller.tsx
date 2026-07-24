import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { isElectron } from "../env";
import { useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { useSidebar } from "../components/ui/sidebar";
import { codexMicroRemote, type CodexMicroWorkspaceState } from "./remote";
import type { CodexMicroCommand } from "./protocol";
import {
  CODEX_MICRO_ACTIONS,
  getCodexMicroPreferences,
  subscribeCodexMicroPreferences,
  type CodexMicroAction,
} from "./preferences";

const PINS_STORAGE_KEY = "t3.codexMicro.pins.v1";
const SLOT_COUNT = 6;

export const CODEX_MICRO_CHAT_COMMAND_EVENT = "t3-codex-micro-chat-command";
export const CODEX_MICRO_NEW_THREAD_EVENT = "t3-codex-micro-new-thread";

export type CodexMicroChatCommand =
  | { readonly kind: "fast" }
  | { readonly kind: "approve" }
  | { readonly kind: "decline" }
  | { readonly kind: "fork" }
  | { readonly kind: "clear" }
  | { readonly kind: "send" }
  | { readonly kind: "modelPicker" }
  | { readonly kind: "effort"; readonly direction: -1 | 1 }
  | { readonly kind: "plan" }
  | { readonly kind: "browser" }
  | { readonly kind: "terminal" }
  | { readonly kind: "insert"; readonly text: string; readonly submit: boolean };

function readPins(): Array<string | null> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PINS_STORAGE_KEY) ?? "[]");
    if (Array.isArray(value)) {
      const compact = value.filter(
        (pin): pin is string => typeof pin === "string" && pin.length > 0,
      );
      return Array.from({ length: SLOT_COUNT }, (_, index) => compact[index] ?? null);
    }
  } catch {
    // Fall through to an empty layout.
  }
  return Array.from({ length: SLOT_COUNT }, () => null);
}

function writePins(pins: ReadonlyArray<string | null>): void {
  const compact = pins.filter((pin): pin is string => typeof pin === "string" && pin.length > 0);
  const normalized = Array.from({ length: SLOT_COUNT }, (_, index) => compact[index] ?? null);
  localStorage.setItem(PINS_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new Event("t3-codex-micro-pins-changed"));
}

function subscribePins(listener: () => void): () => void {
  window.addEventListener("t3-codex-micro-pins-changed", listener);
  return () => window.removeEventListener("t3-codex-micro-pins-changed", listener);
}

export function useCodexMicroIsPinned(environmentId: string, threadId: string): boolean {
  const serialized = useSyncExternalStore(
    subscribePins,
    () => localStorage.getItem(PINS_STORAGE_KEY) ?? "[]",
    () => "[]",
  );
  try {
    const pins: unknown = JSON.parse(serialized);
    return Array.isArray(pins) && pins.includes(encodeCodexMicroTarget(environmentId, threadId));
  } catch {
    return false;
  }
}

export function resetCodexMicroPins(): void {
  localStorage.removeItem(PINS_STORAGE_KEY);
  window.dispatchEvent(new Event("t3-codex-micro-pins-changed"));
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

function statusForThread(thread: ReturnType<typeof useThreadShells>[number]): string {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "needs_input";
  if (thread.latestTurn?.state === "running") {
    return "working";
  }
  if (thread.latestTurn?.state === "error") return "error";
  if (thread.latestTurn?.state === "completed") return "complete";
  return "idle";
}

function slotForStatus(id: number, status: string, selected: boolean) {
  // Status color is authoritative. A selected working task must remain blue;
  // selection is expressed by the breathing effect, not by erasing its state.
  if (status === "working") {
    return { id, c: 0x304ffe, b: 1, e: 4, s: 0.4, status };
  }
  if (selected) {
    return { id, c: 0xffffff, b: 1, e: 4, s: 0.4, status: "selected" };
  }
  switch (status) {
    case "complete":
      return { id, c: 0x00ff4c, b: 1, e: 1, s: 0, status };
    case "needs_input":
      return { id, c: 0xff8f00, b: 1, e: 4, s: 0.4, status };
    case "error":
      return { id, c: 0xff0033, b: 1, e: 1, s: 0, status };
    default:
      return { id, c: 0xffffff, b: 1, e: 1, s: 0, status: "idle" };
  }
}

function dispatchChatCommand(command: CodexMicroChatCommand): void {
  window.dispatchEvent(
    new CustomEvent<CodexMicroChatCommand>(CODEX_MICRO_CHAT_COMMAND_EVENT, {
      detail: command,
    }),
  );
}

function runAction(
  action: CodexMicroAction,
  selected: string | null,
  navigate: ReturnType<typeof useNavigate>,
  toggleSidebar: () => void,
): void {
  switch (action) {
    case "fast":
    case "clear":
    case "send":
      dispatchChatCommand({ kind: action });
      return;
    case "new":
      window.dispatchEvent(new Event(CODEX_MICRO_NEW_THREAD_EVENT));
      return;
    case "fork":
      dispatchChatCommand({ kind: "fork" });
      return;
    case "pin": {
      if (!selected) return;
      const pins = readPins();
      const existing = pins.indexOf(selected);
      if (existing >= 0) pins[existing] = null;
      else {
        const free = pins.indexOf(null);
        if (free < 0) return;
        pins[free] = selected;
      }
      writePins(pins);
      return;
    }
    case "frontendMax":
      dispatchChatCommand({ kind: "insert", text: "$frontend-max ", submit: false });
      return;
    case "browser":
      dispatchChatCommand({ kind: "browser" });
      return;
    case "terminal":
      dispatchChatCommand({ kind: "terminal" });
      return;
    case "sideChat":
      toggleSidebar();
      return;
  }
}

export function CodexMicroController() {
  const threads = useThreadShells();
  const navigate = useNavigate();
  const location = useLocation();
  const { toggleSidebar } = useSidebar();
  const preferences = useSyncExternalStore(
    subscribeCodexMicroPreferences,
    getCodexMicroPreferences,
    getCodexMicroPreferences,
  );
  const [pinsRevision, setPinsRevision] = useState(0);
  const [nativeVoiceActive, setNativeVoiceActive] = useState(false);
  const [nativeVoiceIssue, setNativeVoiceIssue] = useState<string | null>(null);
  const selected = useMemo(() => {
    const match = location.pathname.match(/^\/([^/]+)\/([^/]+)$/);
    if (!match) return null;
    return encodeCodexMicroTarget(match[1] ?? "", match[2] ?? "");
  }, [location.pathname]);

  useEffect(() => {
    if (!isElectron) return;
    const restore = () => {
      if (document.visibilityState === "visible") {
        void codexMicroRemote.restore();
      }
    };
    restore();
    const reconnectInterval = window.setInterval(restore, 10_000);
    window.addEventListener("focus", restore);
    window.addEventListener("pageshow", restore);
    document.addEventListener("visibilitychange", restore);
    return () => {
      window.clearInterval(reconnectInterval);
      window.removeEventListener("focus", restore);
      window.removeEventListener("pageshow", restore);
      document.removeEventListener("visibilitychange", restore);
    };
  }, []);

  useEffect(() => {
    const onPinsChanged = () => setPinsRevision((revision) => revision + 1);
    window.addEventListener("t3-codex-micro-pins-changed", onPinsChanged);
    return () => {
      window.removeEventListener("t3-codex-micro-pins-changed", onPinsChanged);
    };
  }, []);

  useEffect(() => {
    if (!isElectron) return;
    let pins = readPins();
    const targets = [...threads]
      .filter((thread) => thread.archivedAt === null)
      .sort((left, right) => {
        const newestFirst = Date.parse(right.createdAt) - Date.parse(left.createdAt);
        return Number.isNaN(newestFirst)
          ? String(left.id).localeCompare(String(right.id))
          : newestFirst || String(left.id).localeCompare(String(right.id));
      })
      .map((thread) => ({
        id: encodeCodexMicroTarget(thread.environmentId, thread.id),
        kind: "t3" as const,
        label: thread.title,
        provider: "t3" as const,
        active: encodeCodexMicroTarget(thread.environmentId, thread.id) === selected,
        nativeVoice: false as const,
        status: statusForThread(thread),
      }));
    const previousState = codexMicroRemote.getWorkspaceState();
    const previousTargets =
      document.hidden && previousState
        ? previousState.targets.filter(
            (previous) => !targets.some((target) => target.id === previous.id),
          )
        : [];
    const stableTargets = [
      ...targets,
      ...previousTargets.map((target) => ({ ...target, status: "idle" })),
    ];

    const availableTargetIds = new Set(stableTargets.map((target) => target.id));
    const compactPins = pins.filter(
      (pin): pin is string => typeof pin === "string" && availableTargetIds.has(pin),
    );
    const reconciledPins = Array.from(
      { length: SLOT_COUNT },
      (_, index) => compactPins[index] ?? null,
    );
    if (pins.some((pin, index) => pin !== reconciledPins[index])) {
      pins = reconciledPins;
      writePins(pins);
    }

    if (pins.every((pin) => pin === null) && targets.length > 0) {
      pins = Array.from({ length: SLOT_COUNT }, (_, index) => targets[index]?.id ?? null);
      writePins(pins);
    }

    const targetById = new Map(stableTargets.map((target) => [target.id, target]));
    const slots = pins.map((pin, index) => {
      if (!pin) return { id: index, c: 0, b: 0, e: 0, s: 0, status: "off" };
      const target = targetById.get(pin);
      if (!target) {
        return document.hidden && previousState?.slots[index]
          ? previousState.slots[index]
          : { id: index, c: 0, b: 0, e: 0, s: 0, status: "off" };
      }
      return slotForStatus(index, target.status, pin === selected);
    });
    const state: CodexMicroWorkspaceState = {
      type: "workspace-state",
      version: 2,
      surface: "t3code",
      connected: true,
      lightingBrightness: preferences.brightness / 100,
      autoDimSeconds: preferences.autoDimSeconds,
      targets: stableTargets.map(({ status: _, ...target }) => target),
      pins,
      ...(selected ? { selected } : {}),
      nativeVoiceActive,
      slots,
      controls: {
        actionKeys: preferences.actionKeys.map((action, index) => {
          const descriptor = CODEX_MICRO_ACTIONS.find((candidate) => candidate.value === action)!;
          return {
            key: `ACT0${index + 6}`,
            action,
            label: descriptor.shortLabel,
            symbol: descriptor.symbol,
            accent: descriptor.accent,
          };
        }),
        joystick: preferences.joystick,
      },
    };
    codexMicroRemote.setWorkspaceState(
      nativeVoiceIssue ? { ...state, issue: nativeVoiceIssue } : state,
    );
  }, [nativeVoiceActive, nativeVoiceIssue, pinsRevision, preferences, selected, threads]);

  useEffect(() => {
    if (!isElectron) return;
    const handleCommand = (command: CodexMicroCommand) => {
      if (command.cmd === "setControlTarget" || command.cmd === "refreshState") {
        codexMicroRemote.replayWorkspaceState();
        return;
      }

      if (command.cmd === "vscodeTogglePin") {
        const target =
          typeof command.target === "string" && command.target.length > 0
            ? command.target
            : selected;
        if (!target) return;
        const pins = readPins();
        const existing = pins.indexOf(target);
        if (existing >= 0) {
          pins[existing] = null;
        } else {
          const free = pins.indexOf(null);
          if (free < 0) return;
          pins[free] = target;
        }
        writePins(pins);
        return;
      }

      if (command.cmd === "vscodeNew") {
        window.dispatchEvent(new Event(CODEX_MICRO_NEW_THREAD_EVENT));
        return;
      }

      if (command.cmd === "vscodeInsert") {
        if (typeof command.text !== "string" || command.text.trim().length === 0) return;
        dispatchChatCommand({
          kind: "insert",
          text: command.text,
          submit: command.submit === true,
        });
        return;
      }

      if (command.cmd === "vscodeVoice") {
        const requestedActive = command.active === true;
        const setMacDictation = window.desktopBridge?.setMacDictation;
        if (!setMacDictation) {
          setNativeVoiceActive(false);
          setNativeVoiceIssue("macOS Dictation is unavailable in this T3 Code build.");
          return;
        }
        void setMacDictation(requestedActive).then((result) => {
          setNativeVoiceActive(result.active);
          setNativeVoiceIssue(result.error);
          if (
            !requestedActive &&
            command.autoSend === true &&
            result.error === null &&
            result.active === false
          ) {
            window.setTimeout(() => dispatchChatCommand({ kind: "send" }), 700);
          }
        });
        return;
      }

      if (command.cmd !== "vscodeKey") return;
      const key = typeof command.k === "string" ? command.k : "";
      const actionValue = Number(command.act ?? 1);
      if ((key === "ENC_CW" || key === "ENC_CC") && actionValue === 2) {
        dispatchChatCommand({
          kind: "effort",
          direction: key === "ENC_CC" ? 1 : -1,
        });
        return;
      }
      if (actionValue !== 1) return;

      if (key.startsWith("AG")) {
        const requestedIndex =
          typeof command.ag === "number" ? command.ag : Number.parseInt(key.slice(2), 10);
        const pin = readPins()[requestedIndex] ?? null;
        const target = pin ? decodeCodexMicroTarget(pin) : null;
        if (!target) return;
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(
            scopeThreadRef(target.environmentId as EnvironmentId, target.threadId as ThreadId),
          ),
        });
        return;
      }

      const joystickDirection = {
        JOY_UP: "up",
        JOY_RIGHT: "right",
        JOY_DOWN: "down",
        JOY_LEFT: "left",
      }[key] as keyof typeof preferences.joystick | undefined;
      if (joystickDirection) {
        runAction(preferences.joystick[joystickDirection], selected, navigate, toggleSidebar);
        return;
      }
      if (key === "ENC") {
        dispatchChatCommand({ kind: "modelPicker" });
        return;
      }

      const actionIndex = ["ACT06", "ACT07", "ACT08", "ACT09"].indexOf(key);
      if (actionIndex >= 0) {
        runAction(preferences.actionKeys[actionIndex]!, selected, navigate, toggleSidebar);
        return;
      }
      if (key === "ACT12") dispatchChatCommand({ kind: "send" });
    };
    const unsubscribeBluetooth = codexMicroRemote.subscribeCommands(handleCommand);
    const unsubscribeDesktop = window.desktopBridge?.onCodexMicroCommand((command) => {
      if (command.kind === "effort") {
        dispatchChatCommand({ kind: "effort", direction: command.direction });
        return;
      }
      if (command.kind === "focus") {
        if (command.environmentId && command.threadId) {
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(
              scopeThreadRef(command.environmentId as EnvironmentId, command.threadId as ThreadId),
            ),
          });
        }
        return;
      }
      if (command.kind === "action") {
        switch (command.action) {
          case "fast":
          case "send":
            dispatchChatCommand({ kind: command.action });
            break;
          case "new":
            window.dispatchEvent(new Event(CODEX_MICRO_NEW_THREAD_EVENT));
            break;
          case "fork":
            dispatchChatCommand({ kind: "fork" });
            break;
          case "clear":
            dispatchChatCommand({ kind: "clear" });
            break;
          case "frontendMax":
            dispatchChatCommand({ kind: "insert", text: "$frontend-max ", submit: false });
            break;
          case "browser":
            dispatchChatCommand({ kind: "browser" });
            break;
          case "terminal":
            dispatchChatCommand({ kind: "terminal" });
            break;
          case "sideChat":
            toggleSidebar();
            break;
          case "settings":
            void navigate({ to: "/settings/codex-micro" });
            break;
        }
      }
    });
    return () => {
      unsubscribeBluetooth();
      unsubscribeDesktop?.();
    };
  }, [navigate, preferences, selected, toggleSidebar]);

  return null;
}
