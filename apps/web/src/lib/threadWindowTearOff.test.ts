import { describe, expect, it } from "vite-plus/test";

import { isPointOutsideWindow } from "./threadWindowTearOff";

const windowRect = {
  screenX: 100,
  screenY: 50,
  outerWidth: 1200,
  outerHeight: 800,
};

describe("isPointOutsideWindow", () => {
  it("treats releases over the window as inside", () => {
    expect(isPointOutsideWindow({ x: 700, y: 400 }, windowRect)).toBe(false);
    expect(isPointOutsideWindow({ x: 100, y: 50 }, windowRect)).toBe(false);
    expect(isPointOutsideWindow({ x: 1300, y: 850 }, windowRect)).toBe(false);
  });

  it("keeps an ambiguous release on the frame from tearing off", () => {
    expect(isPointOutsideWindow({ x: 1306, y: 400 }, windowRect)).toBe(false);
    expect(isPointOutsideWindow({ x: 94, y: 400 }, windowRect)).toBe(false);
  });

  it("detects releases clear of the window on every side", () => {
    expect(isPointOutsideWindow({ x: 1400, y: 400 }, windowRect)).toBe(true);
    expect(isPointOutsideWindow({ x: 20, y: 400 }, windowRect)).toBe(true);
    expect(isPointOutsideWindow({ x: 700, y: 10 }, windowRect)).toBe(true);
    expect(isPointOutsideWindow({ x: 700, y: 900 }, windowRect)).toBe(true);
  });

  it("detects releases on a second monitor", () => {
    expect(isPointOutsideWindow({ x: 2400, y: 600 }, windowRect)).toBe(true);
    expect(isPointOutsideWindow({ x: -900, y: 600 }, windowRect)).toBe(true);
  });
});
