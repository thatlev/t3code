export const AGENT_MICRO_SERVICE_UUID = "c0de0001-6e10-4c0d-a5a5-c0deb1d6e001";
export const AGENT_MICRO_INPUT_UUID = "c0de0002-6e10-4c0d-a5a5-c0deb1d6e001";
export const AGENT_MICRO_OUTPUT_UUID = "c0de0003-6e10-4c0d-a5a5-c0deb1d6e001";

export const AGENT_MICRO_CONTROL_CHANNEL = 5;
export const AGENT_MICRO_STATE_CHANNEL = 3;
export const AGENT_MICRO_REPORT_BYTES = 63;
export const AGENT_MICRO_FRAGMENT_BYTES = 61;

export type AgentMicroCommand = {
  readonly cmd: string;
  readonly commandID?: string;
  readonly surface?: string;
  readonly [key: string]: unknown;
};

export function encodeReports(channel: number, value: unknown): ReadonlyArray<Uint8Array> {
  // Newline-terminated, matching the Mac companion. The phone frames on "\n":
  // without a delimiter it falls back to "buffer until the bytes happen to
  // parse as JSON", where one dropped BLE fragment corrupts every later frame
  // on that connection instead of costing only the frame it belonged to.
  const encoded = new TextEncoder().encode(
    `${typeof value === "string" ? value : JSON.stringify(value)}\n`,
  );
  const reports: Uint8Array[] = [];

  for (let offset = 0; offset < encoded.length; offset += AGENT_MICRO_FRAGMENT_BYTES) {
    const length = Math.min(AGENT_MICRO_FRAGMENT_BYTES, encoded.length - offset);
    const report = new Uint8Array(AGENT_MICRO_REPORT_BYTES);
    report[0] = channel;
    report[1] = length;
    report.set(encoded.subarray(offset, offset + length), 2);
    reports.push(report);
  }

  return reports;
}

export class AgentMicroCommandDecoder {
  private pending = "";

  push(reportValue: DataView | Uint8Array): ReadonlyArray<AgentMicroCommand> {
    const bytes =
      reportValue instanceof Uint8Array
        ? reportValue
        : new Uint8Array(reportValue.buffer, reportValue.byteOffset, reportValue.byteLength);
    if (bytes.length < 2 || bytes[0] !== AGENT_MICRO_CONTROL_CHANNEL) {
      return [];
    }

    const length = bytes[1] ?? 0;
    if (length > AGENT_MICRO_FRAGMENT_BYTES || bytes.length < length + 2) {
      this.pending = "";
      return [];
    }

    this.pending += new TextDecoder().decode(bytes.subarray(2, 2 + length));
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";

    const commands: AgentMicroCommand[] = [];
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
          commands.push(value as AgentMicroCommand);
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
