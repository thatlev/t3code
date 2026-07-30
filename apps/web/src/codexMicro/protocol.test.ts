import { describe, expect, it } from "vite-plus/test";

import {
  CODEX_MICRO_CONTROL_CHANNEL,
  CODEX_MICRO_STATE_CHANNEL,
  CodexMicroCommandDecoder,
  encodeReports,
} from "./protocol";

describe("Codex Micro BLE framing", () => {
  it("round-trips fragmented newline-delimited phone commands", () => {
    const command = {
      cmd: "vscodeInsert",
      surface: "t3code",
      text: "A long dictated prompt ".repeat(8),
      commandID: "one",
    };
    const reports = encodeReports(CODEX_MICRO_CONTROL_CHANNEL, `${JSON.stringify(command)}\n`);
    const decoder = new CodexMicroCommandDecoder();

    expect(reports.length).toBeGreaterThan(1);
    expect(reports.flatMap((report) => decoder.push(report))).toEqual([command]);
  });

  it("frames host state as fixed-size channel-three reports", () => {
    const reports = encodeReports(CODEX_MICRO_STATE_CHANNEL, {
      type: "workspace-state",
      surface: "t3code",
      targets: Array.from({ length: 12 }, (_, id) => ({ id, label: `Task ${id}` })),
    });

    expect(reports.length).toBeGreaterThan(1);
    expect(reports.every((report) => report.length === 63)).toBe(true);
    expect(reports.every((report) => report[0] === CODEX_MICRO_STATE_CHANNEL)).toBe(true);
    expect(reports.every((report) => (report[1] ?? 0) <= 61)).toBe(true);
  });

  it("terminates every frame with a newline so a dropped fragment costs one frame", () => {
    // Without the delimiter the phone buffers until the bytes happen to parse
    // as JSON, so a single lost fragment corrupts every frame after it.
    const reports = encodeReports(CODEX_MICRO_STATE_CHANNEL, { type: "workspace-state" });
    const last = reports.at(-1);

    expect(last).toBeDefined();
    const length = last![1] ?? 0;
    expect(last![1 + length]).toBe(0x0a);
  });

  it("ignores unrelated and malformed reports without poisoning the next command", () => {
    const decoder = new CodexMicroCommandDecoder();
    const malformed = new Uint8Array([CODEX_MICRO_CONTROL_CHANNEL, 62]);
    expect(decoder.push(new Uint8Array([2, 0]))).toEqual([]);
    expect(decoder.push(malformed)).toEqual([]);

    const valid = encodeReports(
      CODEX_MICRO_CONTROL_CHANNEL,
      `${JSON.stringify({ cmd: "vscodeKey", k: "ACT12", act: 1 })}\n`,
    );
    expect(valid.flatMap((report) => decoder.push(report))).toHaveLength(1);
  });
});
