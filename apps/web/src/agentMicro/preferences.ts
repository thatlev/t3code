export type AgentMicroPreferences = {
  readonly brightness: number;
  readonly autoDimSeconds: number;
  readonly autoPinNewChats: boolean;
  /**
   * What the encoder dial drives. The phone always emits both a coarse detent
   * stream (one per 90° of turn) and a fine scroll stream (one per 15°); this
   * picks which one T3 Code listens to, so switching modes needs no phone-side
   * setting and no round-trip.
   */
  readonly dialFunction: AgentMicroDialFunction;
  readonly actionKeys: readonly [
    AgentMicroAction,
    AgentMicroAction,
    AgentMicroAction,
    AgentMicroAction,
  ];
  readonly joystick: Readonly<Record<AgentMicroJoystickDirection, AgentMicroAction>>;
};

export type AgentMicroAction =
  | "fast"
  | "new"
  | "pin"
  | "fork"
  | "clear"
  | "send"
  | "frontendMax"
  | "browser"
  | "terminal"
  | "sideChat";

export type AgentMicroJoystickDirection = "up" | "right" | "down" | "left";

export type AgentMicroDialFunction = "effort" | "scroll";

export const AGENT_MICRO_DIAL_FUNCTIONS: ReadonlyArray<{
  readonly value: AgentMicroDialFunction;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: "effort",
    label: "Reasoning effort",
    description: "A quarter turn steps the model's reasoning level by one.",
  },
  {
    value: "scroll",
    label: "Scroll the chat",
    description: "Turning scrolls the conversation smoothly, like a scroll wheel.",
  },
];

const DIAL_FUNCTION_VALUES = new Set<AgentMicroDialFunction>(
  AGENT_MICRO_DIAL_FUNCTIONS.map((entry) => entry.value),
);

function isDialFunction(value: unknown): value is AgentMicroDialFunction {
  return typeof value === "string" && DIAL_FUNCTION_VALUES.has(value as AgentMicroDialFunction);
}

export const AGENT_MICRO_ACTIONS: ReadonlyArray<{
  readonly value: AgentMicroAction;
  readonly label: string;
  readonly shortLabel: string;
  readonly symbol: string;
  readonly accent: number;
}> = [
  { value: "fast", label: "Fast mode", shortLabel: "FAST", symbol: "bolt.fill", accent: 0x168aff },
  {
    value: "new",
    label: "New task",
    shortLabel: "NEW",
    symbol: "square.and.pencil",
    accent: 0x168a55,
  },
  {
    value: "pin",
    label: "Pin or unpin task",
    shortLabel: "PIN",
    symbol: "pin.fill",
    accent: 0x8b5cf6,
  },
  {
    value: "fork",
    label: "Fork task",
    shortLabel: "FORK",
    symbol: "arrow.triangle.branch",
    accent: 0x5856d6,
  },
  {
    value: "clear",
    label: "Clear message bar",
    shortLabel: "CLEAR",
    symbol: "trash",
    accent: 0x5b6675,
  },
  { value: "send", label: "Send prompt", shortLabel: "SEND", symbol: "arrow.up", accent: 0x168a55 },
  {
    value: "frontendMax",
    label: "Frontend Max",
    shortLabel: "MAX",
    symbol: "wand.and.stars",
    accent: 0x8b5cf6,
  },
  {
    value: "browser",
    label: "Toggle browser",
    shortLabel: "WEB",
    symbol: "globe",
    accent: 0x168aff,
  },
  {
    value: "terminal",
    label: "Toggle terminal",
    shortLabel: "TERM",
    symbol: "terminal",
    accent: 0x5b6675,
  },
  {
    value: "sideChat",
    label: "Toggle side chat",
    shortLabel: "CHAT",
    symbol: "sidebar.left",
    accent: 0x5b6675,
  },
];

const ACTION_VALUES = new Set<AgentMicroAction>(AGENT_MICRO_ACTIONS.map((action) => action.value));

const STORAGE_KEY = "t3.agentMicro.preferences.v1";
const CHANGE_EVENT = "t3-agent-micro-preferences-changed";

export const DEFAULT_AGENT_MICRO_PREFERENCES: AgentMicroPreferences = {
  brightness: 100,
  autoDimSeconds: 180,
  autoPinNewChats: true,
  dialFunction: "effort",
  actionKeys: ["fast", "new", "pin", "clear"],
  joystick: {
    up: "frontendMax",
    right: "browser",
    down: "terminal",
    left: "sideChat",
  },
};

function isAction(value: unknown): value is AgentMicroAction {
  return typeof value === "string" && ACTION_VALUES.has(value as AgentMicroAction);
}

function readStoredPreferences(): AgentMicroPreferences {
  if (typeof localStorage === "undefined") return DEFAULT_AGENT_MICRO_PREFERENCES;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (value && typeof value === "object") {
      const candidate = value as {
        brightness?: unknown;
        autoDimSeconds?: unknown;
        autoPinNewChats?: unknown;
        dialFunction?: unknown;
        actionKeys?: unknown;
        joystick?: unknown;
      };
      const brightness =
        typeof candidate.brightness === "number"
          ? Math.min(100, Math.max(0, Math.round(candidate.brightness)))
          : DEFAULT_AGENT_MICRO_PREFERENCES.brightness;
      const autoDimSeconds =
        typeof candidate.autoDimSeconds === "number" &&
        [0, 60, 180, 300].includes(candidate.autoDimSeconds)
          ? candidate.autoDimSeconds
          : DEFAULT_AGENT_MICRO_PREFERENCES.autoDimSeconds;
      const autoPinNewChats =
        typeof candidate.autoPinNewChats === "boolean"
          ? candidate.autoPinNewChats
          : DEFAULT_AGENT_MICRO_PREFERENCES.autoPinNewChats;
      const dialFunction = isDialFunction(candidate.dialFunction)
        ? candidate.dialFunction
        : DEFAULT_AGENT_MICRO_PREFERENCES.dialFunction;
      const storedActionKeys = Array.isArray(candidate.actionKeys) ? candidate.actionKeys : [];
      const actionAt = (index: number): AgentMicroAction =>
        isAction(storedActionKeys[index])
          ? storedActionKeys[index]
          : DEFAULT_AGENT_MICRO_PREFERENCES.actionKeys[index]!;
      const actionKeys: AgentMicroPreferences["actionKeys"] = [
        actionAt(0),
        actionAt(1),
        actionAt(2),
        actionAt(3),
      ];
      const storedJoystick =
        candidate.joystick && typeof candidate.joystick === "object"
          ? (candidate.joystick as Record<string, unknown>)
          : {};
      const joystick = Object.fromEntries(
        (["up", "right", "down", "left"] as const).map((direction) => [
          direction,
          isAction(storedJoystick[direction])
            ? storedJoystick[direction]
            : DEFAULT_AGENT_MICRO_PREFERENCES.joystick[direction],
        ]),
      ) as AgentMicroPreferences["joystick"];
      return { brightness, autoDimSeconds, autoPinNewChats, dialFunction, actionKeys, joystick };
    }
  } catch {
    // Damaged preferences safely fall back to the device defaults.
  }
  return DEFAULT_AGENT_MICRO_PREFERENCES;
}

let cachedPreferences = readStoredPreferences();

export function getAgentMicroPreferences(): AgentMicroPreferences {
  return cachedPreferences;
}

export function subscribeAgentMicroPreferences(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

export function setAgentMicroPreferences(patch: Partial<AgentMicroPreferences>): void {
  cachedPreferences = {
    brightness:
      patch.brightness === undefined
        ? cachedPreferences.brightness
        : Math.min(100, Math.max(0, Math.round(patch.brightness))),
    autoDimSeconds:
      patch.autoDimSeconds === undefined
        ? cachedPreferences.autoDimSeconds
        : [0, 60, 180, 300].includes(patch.autoDimSeconds)
          ? patch.autoDimSeconds
          : cachedPreferences.autoDimSeconds,
    autoPinNewChats: patch.autoPinNewChats ?? cachedPreferences.autoPinNewChats,
    dialFunction: isDialFunction(patch.dialFunction)
      ? patch.dialFunction
      : cachedPreferences.dialFunction,
    actionKeys: patch.actionKeys ?? cachedPreferences.actionKeys,
    joystick: patch.joystick ?? cachedPreferences.joystick,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedPreferences));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function resetAgentMicroPreferences(): void {
  cachedPreferences = DEFAULT_AGENT_MICRO_PREFERENCES;
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
