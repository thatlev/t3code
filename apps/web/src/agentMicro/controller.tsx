import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { isElectron } from "../env";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { useAllEnvironmentShellsBootstrapped, useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { focusThreadInOwningWindow, onThreadWindowFocus } from "../threadWindowScope";
import { useUiStateStore } from "../uiStateStore";
import { useSidebar } from "../components/ui/sidebar";
import { slotForStatus, statusForThread } from "./lights";
import { agentMicroRemote, type AgentMicroWorkspaceState } from "./remote";
import type { AgentMicroCommand } from "./protocol";
import {
  applyAgentMicroAutoPins,
  decodeAgentMicroTarget,
  encodeAgentMicroTarget,
  readAgentMicroPins,
  reconcileAgentMicroPins,
  subscribeAgentMicroAutoPinRequests,
  toggleAgentMicroPin,
  writeAgentMicroPins,
} from "./pins";
import { decodeAgentMicroProject, encodeAgentMicroProject } from "./projects";
import {
  AGENT_MICRO_ACTIONS,
  getAgentMicroPreferences,
  subscribeAgentMicroPreferences,
  type AgentMicroAction,
} from "./preferences";

export const AGENT_MICRO_CHAT_COMMAND_EVENT = "t3-agent-micro-chat-command";
export const AGENT_MICRO_NEW_THREAD_EVENT = "t3-agent-micro-new-thread";

export type AgentMicroChatCommand =
  | { readonly kind: "fast" }
  | { readonly kind: "approve" }
  | { readonly kind: "decline" }
  | { readonly kind: "fork" }
  | { readonly kind: "clear" }
  | { readonly kind: "send" }
  | { readonly kind: "effort"; readonly direction: -1 | 1 }
  | { readonly kind: "scroll"; readonly direction: -1 | 1 }
  | { readonly kind: "plan" }
  | { readonly kind: "browser" }
  | { readonly kind: "terminal" }
  | { readonly kind: "focusComposer" }
  | { readonly kind: "insert"; readonly text: string; readonly submit: boolean };

export {
  encodeAgentMicroTarget,
  resetAgentMicroPins,
  useAgentMicroIsPinned,
  useAgentMicroPinnedTargets,
} from "./pins";

function dispatchChatCommand(command: AgentMicroChatCommand): void {
  window.dispatchEvent(
    new CustomEvent<AgentMicroChatCommand>(AGENT_MICRO_CHAT_COMMAND_EVENT, {
      detail: command,
    }),
  );
}

function runAction(
  action: AgentMicroAction,
  selected: string | null,
  navigate: ReturnType<typeof useNavigate>,
  toggleSidebar: () => void,
  startNewThread: () => void,
): void {
  switch (action) {
    case "fast":
    case "clear":
    case "send":
      dispatchChatCommand({ kind: action });
      return;
    case "new":
      startNewThread();
      return;
    case "fork":
      dispatchChatCommand({ kind: "fork" });
      return;
    case "pin": {
      if (!selected) return;
      toggleAgentMicroPin(selected);
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

export function AgentMicroController() {
  const threads = useThreadShells();
  const threadsBootstrapped = useAllEnvironmentShellsBootstrapped();
  const navigate = useNavigate();
  const location = useLocation();
  const { toggleSidebar } = useSidebar();
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread, orderedProjects } =
    useHandleNewThread();
  const preferences = useSyncExternalStore(
    subscribeAgentMicroPreferences,
    getAgentMicroPreferences,
    getAgentMicroPreferences,
  );
  const [pinsRevision, setPinsRevision] = useState(0);
  const [pendingAutoPins, setPendingAutoPins] = useState<readonly string[]>([]);
  const [nativeVoiceActive, setNativeVoiceActive] = useState(false);
  const [nativeVoiceIssue, setNativeVoiceIssue] = useState<string | null>(null);
  const threadLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const selected = useMemo(() => {
    const match = location.pathname.match(/^\/([^/]+)\/([^/]+)$/);
    if (!match) return null;
    return encodeAgentMicroTarget(match[1] ?? "", match[2] ?? "");
  }, [location.pathname]);
  // A pinned key names a chat, not "whatever is in front of me". If that chat
  // lives in another window, raise that window instead of navigating here —
  // navigating would *move* the chat, and a torn-off window that loses its last
  // chat closes.
  const openThreadTarget = useCallback(
    (environmentId: string, threadId: string) => {
      const threadRef = scopeThreadRef(environmentId as EnvironmentId, threadId as ThreadId);
      void (async () => {
        if (await focusThreadInOwningWindow(scopedThreadKey(threadRef))) return;
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(threadRef),
        });
      })().catch(() => undefined);
    },
    [navigate],
  );

  // The window that owns a chat is asked to show it when another window's
  // remote or deep link targets it.
  useEffect(
    () =>
      onThreadWindowFocus((threadKey) => {
        const threadRef = parseScopedThreadKey(threadKey);
        if (!threadRef) return;
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(threadRef),
        });
      }),
    [navigate],
  );

  const startAgentMicroNewThread = useCallback(() => {
    void startNewThreadFromContext({
      activeDraftThread,
      activeThread: activeThread ?? undefined,
      defaultProjectRef,
      handleNewThread,
    });
  }, [activeDraftThread, activeThread, defaultProjectRef, handleNewThread]);

  // The projects the phone offers in its NEW picker, in the same order the
  // sidebar shows them so the two surfaces agree on "the first project".
  const agentMicroProjects = useMemo(
    () =>
      orderedProjects.map((project) => ({
        id: encodeAgentMicroProject(project.environmentId, project.id),
        title: project.title,
      })),
    [orderedProjects],
  );

  // NEW resolves to the project the user picked on the board. An id this
  // client no longer knows (a project removed while the picker was open)
  // falls back to the contextual default rather than doing nothing.
  const startAgentMicroNewThreadInProject = useCallback(
    (encodedProjectId: string) => {
      const decoded = decodeAgentMicroProject(encodedProjectId);
      const project = decoded
        ? orderedProjects.find(
            (candidate) =>
              candidate.id === decoded.projectId &&
              candidate.environmentId === decoded.environmentId,
          )
        : undefined;
      if (!project) {
        startAgentMicroNewThread();
        return;
      }
      void handleNewThread(scopeProjectRef(project.environmentId, project.id));
    },
    [handleNewThread, orderedProjects, startAgentMicroNewThread],
  );

  // Keep the new-thread action mounted across every route, including
  // Settings. AgentMicro commands must leave Settings and navigate into the
  // new draft instead of relying on a listener that only exists on chat
  // routes.
  useEffect(() => {
    window.addEventListener(AGENT_MICRO_NEW_THREAD_EVENT, startAgentMicroNewThread);
    return () => {
      window.removeEventListener(AGENT_MICRO_NEW_THREAD_EVENT, startAgentMicroNewThread);
    };
  }, [startAgentMicroNewThread]);

  useEffect(() => {
    if (!isElectron) return;
    let reconnectInterval: number | null = null;
    const restore = () => {
      if (document.visibilityState === "visible") {
        void agentMicroRemote.restore();
      }
    };
    const stopReconnectInterval = () => {
      if (reconnectInterval === null) return;
      window.clearInterval(reconnectInterval);
      reconnectInterval = null;
    };
    const startReconnectInterval = () => {
      if (reconnectInterval !== null || document.visibilityState !== "visible") return;
      restore();
      reconnectInterval = window.setInterval(restore, 10_000);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") startReconnectInterval();
      else stopReconnectInterval();
    };
    startReconnectInterval();
    window.addEventListener("focus", restore);
    window.addEventListener("pageshow", restore);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopReconnectInterval();
      window.removeEventListener("focus", restore);
      window.removeEventListener("pageshow", restore);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const onPinsChanged = () => setPinsRevision((revision) => revision + 1);
    window.addEventListener("t3-agent-micro-pins-changed", onPinsChanged);
    return () => {
      window.removeEventListener("t3-agent-micro-pins-changed", onPinsChanged);
    };
  }, []);

  useEffect(
    () =>
      subscribeAgentMicroAutoPinRequests((target) => {
        setPendingAutoPins((current) =>
          current.includes(target) ? current : [...current, target],
        );
      }),
    [],
  );

  // Pin bookkeeping runs on every client (plain web included), not just
  // where the AgentMicro hardware is attached. Reconciliation drops a pin
  // only when its thread is positively archived — a thread that is briefly
  // missing from the shell list (environment reconnecting, snapshot
  // refreshing) keeps its pin, so transient loads can never erode the
  // persisted layout.
  useEffect(() => {
    if (!threadsBootstrapped) return;
    const pins = readAgentMicroPins();
    const availableTargetIds = new Set(
      threads
        .filter((thread) => thread.archivedAt === null)
        .map((thread) => encodeAgentMicroTarget(thread.environmentId, thread.id)),
    );
    const archivedTargetIds = new Set(
      threads
        .filter((thread) => thread.archivedAt !== null)
        .map((thread) => encodeAgentMicroTarget(thread.environmentId, thread.id)),
    );
    const reconciledPins = reconcileAgentMicroPins(pins, archivedTargetIds);
    let pinsChanged = pins.some((pin, index) => pin !== reconciledPins[index]);
    const autoPinResult = applyAgentMicroAutoPins(
      reconciledPins,
      pendingAutoPins,
      availableTargetIds,
    );
    pinsChanged ||= reconciledPins.some((pin, index) => pin !== autoPinResult.pins[index]);

    if (autoPinResult.handledTargets.length > 0) {
      const handled = new Set(autoPinResult.handledTargets);
      setPendingAutoPins((current) => current.filter((target) => !handled.has(target)));
    }

    if (pinsChanged) {
      writeAgentMicroPins(autoPinResult.pins);
    }
  }, [pendingAutoPins, pinsRevision, threads, threadsBootstrapped]);

  useEffect(() => {
    if (!isElectron) return;
    const pins = readAgentMicroPins();
    const targets = [...threads]
      .filter((thread) => thread.archivedAt === null)
      .sort((left, right) => {
        const newestFirst = Date.parse(right.createdAt) - Date.parse(left.createdAt);
        return Number.isNaN(newestFirst)
          ? String(left.id).localeCompare(String(right.id))
          : newestFirst || String(left.id).localeCompare(String(right.id));
      })
      .map((thread) => ({
        id: encodeAgentMicroTarget(thread.environmentId, thread.id),
        kind: "t3" as const,
        label: thread.title,
        provider: "t3" as const,
        active: encodeAgentMicroTarget(thread.environmentId, thread.id) === selected,
        nativeVoice: false as const,
        status: statusForThread(
          thread,
          threadLastVisitedAtById[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
        ),
      }));
    const previousState = agentMicroRemote.getWorkspaceState();
    const previousTargets =
      document.hidden && previousState
        ? previousState.targets.filter(
            (previous) => !targets.some((target) => target.id === previous.id),
          )
        : [];
    const stableTargets = [
      ...targets,
      ...previousTargets.map((target) => ({ ...target, status: "idle" as const })),
    ];

    const targetById = new Map(stableTargets.map((target) => [target.id, target]));
    const slots = pins.map((pin, index) => {
      if (!pin) return { id: index, c: 0, b: 0, e: 0, s: 0, status: "off" };
      const target = targetById.get(pin);
      if (!target) {
        // A pin whose thread is momentarily absent (environment reconnecting,
        // shell snapshot refreshing) must not blink the key off: real removals
        // drop the pin itself, so a missing shell is always transient. Reuse
        // the last published slot state until the thread returns.
        return previousState?.slots[index] ?? { id: index, c: 0, b: 0, e: 0, s: 0, status: "off" };
      }
      return slotForStatus(index, target.status, pin === selected);
    });
    const state: AgentMicroWorkspaceState = {
      type: "workspace-state",
      version: 2,
      surface: "t3code",
      connected: true,
      lightingBrightness: preferences.brightness / 100,
      autoDimSeconds: preferences.autoDimSeconds,
      targets: stableTargets.map(({ status: _, ...target }) => target),
      projects: agentMicroProjects,
      pins,
      ...(selected ? { selected } : {}),
      nativeVoiceActive,
      slots,
      controls: {
        actionKeys: preferences.actionKeys.map((action, index) => {
          const descriptor = AGENT_MICRO_ACTIONS.find((candidate) => candidate.value === action)!;
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
    agentMicroRemote.setWorkspaceState(
      nativeVoiceIssue ? { ...state, issue: nativeVoiceIssue } : state,
    );
  }, [
    agentMicroProjects,
    nativeVoiceActive,
    nativeVoiceIssue,
    pinsRevision,
    preferences,
    selected,
    threadLastVisitedAtById,
    threads,
  ]);

  useEffect(() => {
    if (!isElectron) return;
    const handleCommand = (command: AgentMicroCommand) => {
      if (command.cmd === "setControlTarget" || command.cmd === "refreshState") {
        agentMicroRemote.replayWorkspaceState();
        return;
      }

      if (command.cmd === "vscodeTogglePin") {
        const target =
          typeof command.target === "string" && command.target.length > 0
            ? command.target
            : selected;
        if (!target) return;
        toggleAgentMicroPin(target);
        return;
      }

      if (command.cmd === "vscodeNew") {
        // Newer phone builds send the project chosen in the board's picker.
        // Older ones send nothing and keep the contextual-default behaviour.
        if (typeof command.project === "string" && command.project.length > 0) {
          startAgentMicroNewThreadInProject(command.project);
          return;
        }
        startAgentMicroNewThread();
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
        if (requestedActive) dispatchChatCommand({ kind: "focusComposer" });
        window.setTimeout(
          () =>
            void setMacDictation(requestedActive)
              .then((result) => {
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
              })
              .catch(() => {
                setNativeVoiceActive(false);
                setNativeVoiceIssue("T3 Code could not reach macOS Dictation.");
              }),
          requestedActive ? 100 : 0,
        );
        return;
      }

      if (command.cmd !== "vscodeKey") return;
      const key = typeof command.k === "string" ? command.k : "";
      const actionValue = Number(command.act ?? 1);
      // The dial emits two streams at once: a coarse detent (one per 90° of
      // turn) and a fine scroll tick (one per 15°). The setting picks which
      // stream is live, so switching the dial's job needs no phone-side
      // preference and no round-trip — the unused stream is simply dropped.
      if (key === "ENC_CW" || key === "ENC_CC") {
        if (preferences.dialFunction !== "effort") return;
        dispatchChatCommand({
          kind: "effort",
          direction: key === "ENC_CC" ? 1 : -1,
        });
        return;
      }
      if (key === "ENC_SCROLL_CW" || key === "ENC_SCROLL_CC") {
        if (preferences.dialFunction !== "scroll") return;
        dispatchChatCommand({
          kind: "scroll",
          // Clockwise always means "forward": down the transcript.
          direction: key === "ENC_SCROLL_CC" ? 1 : -1,
        });
        return;
      }
      if (actionValue !== 1) return;

      if (key.startsWith("AG")) {
        const requestedIndex =
          typeof command.ag === "number" ? command.ag : Number.parseInt(key.slice(2), 10);
        const pin = readAgentMicroPins()[requestedIndex] ?? null;
        const target = pin ? decodeAgentMicroTarget(pin) : null;
        if (!target) return;
        openThreadTarget(target.environmentId, target.threadId);
        return;
      }

      const joystickDirection = {
        JOY_UP: "up",
        JOY_RIGHT: "right",
        JOY_DOWN: "down",
        JOY_LEFT: "left",
      }[key] as keyof typeof preferences.joystick | undefined;
      if (joystickDirection) {
        runAction(
          preferences.joystick[joystickDirection],
          selected,
          navigate,
          toggleSidebar,
          startAgentMicroNewThread,
        );
        return;
      }
      if (key === "ENC") {
        dispatchChatCommand({ kind: "effort", direction: 1 });
        return;
      }

      const actionIndex = ["ACT06", "ACT07", "ACT08", "ACT09"].indexOf(key);
      if (actionIndex >= 0) {
        runAction(
          preferences.actionKeys[actionIndex]!,
          selected,
          navigate,
          toggleSidebar,
          startAgentMicroNewThread,
        );
        return;
      }
      if (key === "ACT12") dispatchChatCommand({ kind: "send" });
    };
    const unsubscribeBluetooth = agentMicroRemote.subscribeCommands(handleCommand);
    const unsubscribeDesktop = window.desktopBridge?.onAgentMicroCommand((command) => {
      if (command.kind === "effort") {
        dispatchChatCommand({ kind: "effort", direction: command.direction });
        return;
      }
      if (command.kind === "focus") {
        if (command.environmentId && command.threadId) {
          openThreadTarget(command.environmentId, command.threadId);
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
            startAgentMicroNewThread();
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
            void navigate({ to: "/settings/agent-micro" });
            break;
        }
      }
    });
    return () => {
      unsubscribeBluetooth();
      unsubscribeDesktop?.();
    };
  }, [
    navigate,
    openThreadTarget,
    preferences,
    selected,
    startAgentMicroNewThread,
    startAgentMicroNewThreadInProject,
    toggleSidebar,
  ]);

  return null;
}
