import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

function createLocalStorageStub(initialValue?: string): Storage {
  const values = new Map<string, string>();
  if (initialValue !== undefined) {
    values.set("t3.codexMicro.preferences.v1", initialValue);
  }
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Codex Micro preferences", () => {
  it("enables auto-pin for preferences saved before the option existed", async () => {
    vi.stubGlobal(
      "localStorage",
      createLocalStorageStub(
        JSON.stringify({
          brightness: 80,
          autoDimSeconds: 180,
          actionKeys: ["fast", "new", "pin", "clear"],
          joystick: {
            up: "frontendMax",
            right: "browser",
            down: "terminal",
            left: "sideChat",
          },
        }),
      ),
    );

    const { getCodexMicroPreferences } = await import("./preferences");
    expect(getCodexMicroPreferences().autoPinNewChats).toBe(true);
  });

  it("defaults the knob to reasoning effort and persists a switch to scroll", async () => {
    const storage = createLocalStorageStub();
    vi.stubGlobal("localStorage", storage);

    const { getCodexMicroPreferences, setCodexMicroPreferences } = await import("./preferences");
    expect(getCodexMicroPreferences().dialFunction).toBe("effort");

    setCodexMicroPreferences({ dialFunction: "scroll" });
    expect(getCodexMicroPreferences().dialFunction).toBe("scroll");
    expect(JSON.parse(storage.getItem("t3.codexMicro.preferences.v1") ?? "{}").dialFunction).toBe(
      "scroll",
    );
  });

  it("ignores a damaged knob function instead of losing the setting", async () => {
    vi.stubGlobal(
      "localStorage",
      createLocalStorageStub(JSON.stringify({ brightness: 80, dialFunction: "nonsense" })),
    );

    const { getCodexMicroPreferences } = await import("./preferences");
    expect(getCodexMicroPreferences().dialFunction).toBe("effort");
  });

  it("persists auto-pin when the user turns it off", async () => {
    const storage = createLocalStorageStub();
    vi.stubGlobal("localStorage", storage);

    const { getCodexMicroPreferences, setCodexMicroPreferences } = await import("./preferences");
    setCodexMicroPreferences({ autoPinNewChats: false });

    expect(getCodexMicroPreferences().autoPinNewChats).toBe(false);
    expect(
      JSON.parse(storage.getItem("t3.codexMicro.preferences.v1") ?? "{}").autoPinNewChats,
    ).toBe(false);
  });
});
