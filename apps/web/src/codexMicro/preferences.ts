export type CodexMicroPreferences = {
  readonly brightness: number;
  readonly autoDimSeconds: number;
  readonly actionKeys: readonly [
    CodexMicroAction,
    CodexMicroAction,
    CodexMicroAction,
    CodexMicroAction,
  ];
  readonly joystick: Readonly<Record<CodexMicroJoystickDirection, CodexMicroAction>>;
};

export type CodexMicroAction =
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

export type CodexMicroJoystickDirection = "up" | "right" | "down" | "left";

export const CODEX_MICRO_ACTIONS: ReadonlyArray<{
  readonly value: CodexMicroAction;
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

const ACTION_VALUES = new Set<CodexMicroAction>(CODEX_MICRO_ACTIONS.map((action) => action.value));

const STORAGE_KEY = "t3.codexMicro.preferences.v1";
const CHANGE_EVENT = "t3-codex-micro-preferences-changed";

export const DEFAULT_CODEX_MICRO_PREFERENCES: CodexMicroPreferences = {
  brightness: 100,
  autoDimSeconds: 180,
  actionKeys: ["fast", "new", "pin", "clear"],
  joystick: {
    up: "frontendMax",
    right: "browser",
    down: "terminal",
    left: "sideChat",
  },
};

function isAction(value: unknown): value is CodexMicroAction {
  return typeof value === "string" && ACTION_VALUES.has(value as CodexMicroAction);
}

function readStoredPreferences(): CodexMicroPreferences {
  if (typeof localStorage === "undefined") return DEFAULT_CODEX_MICRO_PREFERENCES;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (value && typeof value === "object") {
      const candidate = value as {
        brightness?: unknown;
        autoDimSeconds?: unknown;
        actionKeys?: unknown;
        joystick?: unknown;
      };
      const brightness =
        typeof candidate.brightness === "number"
          ? Math.min(100, Math.max(0, Math.round(candidate.brightness)))
          : DEFAULT_CODEX_MICRO_PREFERENCES.brightness;
      const autoDimSeconds =
        typeof candidate.autoDimSeconds === "number" &&
        [0, 60, 180, 300].includes(candidate.autoDimSeconds)
          ? candidate.autoDimSeconds
          : DEFAULT_CODEX_MICRO_PREFERENCES.autoDimSeconds;
      const storedActionKeys = Array.isArray(candidate.actionKeys) ? candidate.actionKeys : [];
      const actionAt = (index: number): CodexMicroAction =>
        isAction(storedActionKeys[index])
          ? storedActionKeys[index]
          : DEFAULT_CODEX_MICRO_PREFERENCES.actionKeys[index]!;
      const actionKeys: CodexMicroPreferences["actionKeys"] = [
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
            : DEFAULT_CODEX_MICRO_PREFERENCES.joystick[direction],
        ]),
      ) as CodexMicroPreferences["joystick"];
      return { brightness, autoDimSeconds, actionKeys, joystick };
    }
  } catch {
    // Damaged preferences safely fall back to the device defaults.
  }
  return DEFAULT_CODEX_MICRO_PREFERENCES;
}

let cachedPreferences = readStoredPreferences();

export function getCodexMicroPreferences(): CodexMicroPreferences {
  return cachedPreferences;
}

export function subscribeCodexMicroPreferences(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

export function setCodexMicroPreferences(patch: Partial<CodexMicroPreferences>): void {
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
    actionKeys: patch.actionKeys ?? cachedPreferences.actionKeys,
    joystick: patch.joystick ?? cachedPreferences.joystick,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedPreferences));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function resetCodexMicroPreferences(): void {
  cachedPreferences = DEFAULT_CODEX_MICRO_PREFERENCES;
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
