export const CODEX_MICRO_SERVICE_UUID = "c0de0001-6e10-4c0d-a5a5-c0deb1d6e001";
export const CODEX_MICRO_INPUT_UUID = "c0de0002-6e10-4c0d-a5a5-c0deb1d6e001";
export const CODEX_MICRO_OUTPUT_UUID = "c0de0003-6e10-4c0d-a5a5-c0deb1d6e001";

export const CODEX_MICRO_CONTROL_CHANNEL = 5;
export const CODEX_MICRO_STATE_CHANNEL = 3;
export const CODEX_MICRO_REPORT_BYTES = 63;
export const CODEX_MICRO_FRAGMENT_BYTES = 61;

export type CodexMicroCommand = {
  readonly cmd: string;
  readonly commandID?: string;
  readonly surface?: string;
  readonly [key: string]: unknown;
};

export function encodeReports(channel: number, value: unknown): ReadonlyArray<Uint8Array> {
  const encoded = new TextEncoder().encode(
    typeof value === "string" ? value : JSON.stringify(value),
  );
  const reports: Uint8Array[] = [];

  for (let offset = 0; offset < encoded.length; offset += CODEX_MICRO_FRAGMENT_BYTES) {
    const length = Math.min(CODEX_MICRO_FRAGMENT_BYTES, encoded.length - offset);
    const report = new Uint8Array(CODEX_MICRO_REPORT_BYTES);
    report[0] = channel;
    report[1] = length;
    report.set(encoded.subarray(offset, offset + length), 2);
    reports.push(report);
  }

  return reports;
}

export class CodexMicroCommandDecoder {
  private pending = "";

  push(reportValue: DataView | Uint8Array): ReadonlyArray<CodexMicroCommand> {
    const bytes =
      reportValue instanceof Uint8Array
        ? reportValue
        : new Uint8Array(reportValue.buffer, reportValue.byteOffset, reportValue.byteLength);
    if (bytes.length < 2 || bytes[0] !== CODEX_MICRO_CONTROL_CHANNEL) {
      return [];
    }

    const length = bytes[1] ?? 0;
    if (length > CODEX_MICRO_FRAGMENT_BYTES || bytes.length < length + 2) {
      this.pending = "";
      return [];
    }

    this.pending += new TextDecoder().decode(bytes.subarray(2, 2 + length));
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";

    const commands: CodexMicroCommand[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const value: unknown = JSON.parse(trimmed);
        if (
          value &&
          typeof value === "object" &&
          typeof (value as { cmd?: unknown }).cmd === "string"
        ) {
          commands.push(value as CodexMicroCommand);
        }
      } catch {
        // A malformed logical frame is isolated to its newline-delimited command.
      }
    }
    return commands;
  }

  reset(): void {
    this.pending = "";
  }
}
