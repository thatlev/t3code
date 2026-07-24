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
