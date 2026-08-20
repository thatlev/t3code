// @effect-diagnostics nodeBuiltinImport:off - This transport is the Electron process boundary to a local Unix socket.
// @effect-diagnostics globalTimers:off - Reconnect ownership is encapsulated by this lifecycle-managed transport.
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const MAX_FRAME_BYTES = 1 << 20;
const TAG_INPUT = 0x49; // I — iPhone report from the companion
const TAG_OUTPUT = 0x4f; // O — T3 report to the iPhone
const TAG_PRESENCE = 0x50; // P — companion's end-to-end phone presence
const TAG_T3_CLIENT = 0x54; // T — identify this socket client as T3 Code

export type AgentMicroCompanionTransportState = {
  readonly revision: number;
  readonly companionConnected: boolean;
  readonly phoneConnected: boolean;
  readonly error: string | null;
};

type TransportOptions = {
  readonly socketPath?: string;
  readonly onState: (state: AgentMicroCompanionTransportState) => void;
  readonly onInput: (report: Uint8Array) => void;
  readonly onCompanionUnavailable?: () => void;
  readonly reconnectDelayMs?: (attempt: number) => number;
};

export function agentMicroCompanionSocketPath(temporaryDirectory = NodeOS.tmpdir()): string {
  return NodePath.join(temporaryDirectory, "CodexMicro", "codexbridge.sock");
}

export function encodeAgentMicroCompanionFrame(tag: number, payload: Uint8Array): Buffer {
  const frame = Buffer.allocUnsafe(5 + payload.byteLength);
  frame.writeUInt32BE(1 + payload.byteLength, 0);
  frame[4] = tag;
  Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(frame, 5);
  return frame;
}

export class AgentMicroCompanionFrameDecoder {
  private pending = Buffer.alloc(0);

  push(chunk: Uint8Array): ReadonlyArray<{ readonly tag: number; readonly payload: Uint8Array }> {
    this.pending = Buffer.concat([
      this.pending,
      Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
    ]);
    const frames: Array<{ readonly tag: number; readonly payload: Uint8Array }> = [];

    while (this.pending.byteLength >= 4) {
      const length = this.pending.readUInt32BE(0);
      if (length < 1 || length > MAX_FRAME_BYTES) {
        this.pending = Buffer.alloc(0);
        break;
      }
      if (this.pending.byteLength < 4 + length) break;
      const frame = this.pending.subarray(4, 4 + length);
      this.pending = this.pending.subarray(4 + length);
      frames.push({
        tag: frame[0] ?? 0,
        payload: Uint8Array.from(frame.subarray(1)),
      });
    }

    return frames;
  }

  reset(): void {
    this.pending = Buffer.alloc(0);
  }
}

export class AgentMicroCompanionTransport {
  private readonly socketPath: string;
  private readonly onState: TransportOptions["onState"];
  private readonly onInput: TransportOptions["onInput"];
  private readonly onCompanionUnavailable: TransportOptions["onCompanionUnavailable"];
  private readonly reconnectDelayMs: NonNullable<TransportOptions["reconnectDelayMs"]>;
  private state: AgentMicroCompanionTransportState = {
    revision: 0,
    companionConnected: false,
    phoneConnected: false,
    error: null,
  };
  private socket: NodeNet.Socket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private shouldRun = false;

  constructor(options: TransportOptions) {
    this.socketPath = options.socketPath ?? agentMicroCompanionSocketPath();
    this.onState = options.onState;
    this.onInput = options.onInput;
    this.onCompanionUnavailable = options.onCompanionUnavailable;
    this.reconnectDelayMs =
      options.reconnectDelayMs ?? ((attempt) => Math.min(5_000, 250 * 2 ** attempt));
  }

  getState(): AgentMicroCompanionTransportState {
    return this.state;
  }

  start(): void {
    if (this.shouldRun) return;
    this.shouldRun = true;
    this.connect();
  }

  stop(): void {
    this.shouldRun = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();
    this.transition({
      companionConnected: false,
      phoneConnected: false,
      error: null,
    });
  }

  send(report: Uint8Array): boolean {
    const socket = this.socket;
    if (!socket || !this.state.companionConnected || socket.destroyed || !socket.writable) {
      return false;
    }
    socket.write(encodeAgentMicroCompanionFrame(TAG_OUTPUT, report));
    return true;
  }

  private connect(): void {
    if (!this.shouldRun || this.socket !== null) return;
    const decoder = new AgentMicroCompanionFrameDecoder();
    const socket = NodeNet.createConnection(this.socketPath);
    this.socket = socket;
    let connectionError: NodeJS.ErrnoException | null = null;

    socket.on("connect", () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      socket.write(
        encodeAgentMicroCompanionFrame(TAG_T3_CLIENT, new TextEncoder().encode("t3code")),
      );
      this.transition({
        companionConnected: true,
        phoneConnected: false,
        error: null,
      });
    });

    socket.on("data", (chunk) => {
      if (this.socket !== socket) return;
      for (const frame of decoder.push(chunk)) {
        if (frame.tag === TAG_PRESENCE) {
          this.transition({
            companionConnected: true,
            phoneConnected: frame.payload[0] === 1,
            error: null,
          });
        } else if (frame.tag === TAG_INPUT) {
          this.onInput(frame.payload);
        }
      }
    });

    socket.on("error", (error: NodeJS.ErrnoException) => {
      connectionError = error;
    });

    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      decoder.reset();
      const unavailable =
        connectionError?.code === "ENOENT" || connectionError?.code === "ECONNREFUSED";
      this.transition({
        companionConnected: false,
        phoneConnected: false,
        error: unavailable
          ? "Waiting for the AgentMicro menu companion…"
          : connectionError?.message
            ? `AgentMicro companion connection failed: ${connectionError.message}`
            : "AgentMicro companion disconnected. Reconnecting…",
      });
      if (unavailable) this.onCompanionUnavailable?.();
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldRun || this.reconnectTimer !== null) return;
    const delay = this.reconnectDelayMs(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }

  private transition(patch: Omit<Partial<AgentMicroCompanionTransportState>, "revision">): void {
    const next = { ...this.state, ...patch };
    if (
      next.companionConnected === this.state.companionConnected &&
      next.phoneConnected === this.state.phoneConnected &&
      next.error === this.state.error
    ) {
      return;
    }
    this.state = { ...next, revision: this.state.revision + 1 };
    this.onState(this.state);
  }
}
