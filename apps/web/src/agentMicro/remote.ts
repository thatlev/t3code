import type {
  DesktopAgentMicroTransportEvent,
  DesktopAgentMicroTransportState,
} from "@t3tools/contracts";

import {
  AGENT_MICRO_INPUT_UUID,
  AGENT_MICRO_OUTPUT_UUID,
  AGENT_MICRO_SERVICE_UUID,
  AGENT_MICRO_STATE_CHANNEL,
  AgentMicroCommandDecoder,
  encodeReports,
  type AgentMicroCommand,
} from "./protocol";

type BluetoothCharacteristicLike = EventTarget & {
  readonly value?: DataView;
  startNotifications(): Promise<BluetoothCharacteristicLike>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  writeValue?(value: BufferSource): Promise<void>;
};

type BluetoothServiceLike = {
  getCharacteristic(uuid: string): Promise<BluetoothCharacteristicLike>;
};

type BluetoothServerLike = {
  readonly connected: boolean;
  connect(): Promise<BluetoothServerLike>;
  getPrimaryService(uuid: string): Promise<BluetoothServiceLike>;
  disconnect(): void;
};

type BluetoothDeviceLike = EventTarget & {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BluetoothServerLike;
};

type BluetoothLike = {
  getDevices?(): Promise<ReadonlyArray<BluetoothDeviceLike>>;
  requestDevice(options: {
    filters: ReadonlyArray<{ services: ReadonlyArray<string> }>;
    optionalServices: ReadonlyArray<string>;
  }): Promise<BluetoothDeviceLike>;
};

export type AgentMicroConnectionPhase =
  | "unsupported"
  | "disconnected"
  | "scanning"
  | "connecting"
  | "connected"
  | "error";

export type AgentMicroRemoteSnapshot = {
  readonly phase: AgentMicroConnectionPhase;
  readonly deviceName: string | null;
  readonly error: string | null;
  readonly autoReconnect: boolean;
  readonly batteryPercent: number | null;
  readonly charging: boolean;
};

export type AgentMicroWorkspaceState = {
  readonly type: "workspace-state";
  readonly version: 2;
  readonly surface: "t3code";
  readonly connected: boolean;
  readonly lightingBrightness: number;
  readonly autoDimSeconds: number;
  readonly targets: ReadonlyArray<{
    readonly id: string;
    readonly kind: "t3";
    readonly label: string;
    readonly provider: "t3";
    readonly active: boolean;
    readonly nativeVoice: false;
  }>;
  /**
   * Every project the phone may start a new chat in. The NEW key opens a
   * project picker whenever this list is non-empty, so an empty list is the
   * only thing that makes NEW fall back to the default project.
   */
  readonly projects: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
  }>;
  readonly pins: ReadonlyArray<string | null>;
  readonly selected?: string;
  readonly nativeVoiceActive?: boolean;
  readonly slots: ReadonlyArray<{
    readonly id: number;
    readonly c: number;
    readonly b: number;
    readonly e: number;
    readonly s: number;
    readonly status: string;
  }>;
  readonly controls: {
    readonly actionKeys: ReadonlyArray<{
      readonly key: string;
      readonly action: string;
      readonly label: string;
      readonly symbol: string;
      readonly accent: number;
    }>;
    readonly joystick: Readonly<Record<"up" | "right" | "down" | "left", string>>;
  };
  readonly issue?: string;
};

const INITIAL_SNAPSHOT: AgentMicroRemoteSnapshot = {
  phase:
    typeof navigator !== "undefined" && "bluetooth" in navigator ? "disconnected" : "unsupported",
  deviceName: null,
  error: null,
  autoReconnect: true,
  batteryPercent: null,
  charging: false,
};

const WORKSPACE_WRITE_INTERVAL_MS = 100;

/**
 * How long a reported phone drop must persist before the session is torn down.
 *
 * Real reconnects — the phone genuinely dropping and the companion re-linking
 * it — take a couple of seconds, with a tail well past that. Riding them out
 * keeps a recoverable blip from surfacing as a visible connect/disconnect
 * cycle; a phone that is actually gone still tears down, just a moment later.
 */
const PHONE_DROP_GRACE_MS = 8_000;

/**
 * Keys the phone *merges* into its retained per-surface state: an absent key
 * leaves the previous value in place. Everything outside this list is
 * replace-always on the phone (an absent `connected` reads as disconnected, an
 * absent `selected` as no selection), so those fields ship in every frame.
 *
 * This split is what makes delta frames safe, and delta frames are what make
 * the board feel live. A full state carries every thread title and project
 * name — easily kilobytes — and goes out as 61-byte *unacknowledged* GATT
 * writes, so a full rewrite for a single slot turning blue costs dozens of
 * sequential packets: seconds of latency, and dozens of chances for a dropped
 * fragment to corrupt the newline-framed reassembly and leave the keys showing
 * stale or blank lights. A light change now fits in one or two packets.
 */
const MERGEABLE_WORKSPACE_STATE_KEYS = [
  "lightingBrightness",
  "autoDimSeconds",
  "targets",
  "projects",
  "pins",
  "slots",
  "controls",
] as const satisfies ReadonlyArray<keyof AgentMicroWorkspaceState>;

export type AgentMicroWorkspaceStateFrame = Record<string, unknown>;

/**
 * Build the smallest frame that moves the phone from `previous` to `next`.
 * Passing `null` for `previous` produces a full frame, which is what a fresh
 * connection and an explicit replay need.
 */
export function buildWorkspaceStateFrame(
  next: AgentMicroWorkspaceState,
  previous: AgentMicroWorkspaceState | null,
): AgentMicroWorkspaceStateFrame {
  const frame: AgentMicroWorkspaceStateFrame = {
    type: next.type,
    version: next.version,
    surface: next.surface,
    connected: next.connected,
    nativeVoiceActive: next.nativeVoiceActive ?? false,
  };
  if (next.selected !== undefined) frame.selected = next.selected;
  if (next.issue !== undefined) frame.issue = next.issue;

  for (const key of MERGEABLE_WORKSPACE_STATE_KEYS) {
    if (previous === null || JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      frame[key] = next[key];
    }
  }
  return frame;
}

/**
 * True when a frame carries nothing the phone does not already have. The
 * replace-always scalars are present in every frame, so "no mergeable keys and
 * identical scalars" is the real definition of a no-op.
 */
export function isRedundantWorkspaceStateFrame(
  frame: AgentMicroWorkspaceStateFrame,
  previous: AgentMicroWorkspaceState | null,
): boolean {
  if (previous === null) return false;
  if (MERGEABLE_WORKSPACE_STATE_KEYS.some((key) => key in frame)) return false;
  return (
    frame.connected === previous.connected &&
    frame.nativeVoiceActive === (previous.nativeVoiceActive ?? false) &&
    frame.selected === previous.selected &&
    frame.issue === previous.issue
  );
}

class AgentMicroRemote {
  private snapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private readonly commandListeners = new Set<(command: AgentMicroCommand) => void>();
  private readonly decoder = new AgentMicroCommandDecoder();
  private readonly recentCommandIds = new Map<string, number>();
  private device: BluetoothDeviceLike | null = null;
  private output: BluetoothCharacteristicLike | null = null;
  private writeReport: ((report: Uint8Array) => Promise<void>) | null = null;
  private workspaceState: AgentMicroWorkspaceState | null = null;
  /** Last state the phone has certainly received; `null` forces a full frame. */
  private lastSentWorkspaceState: AgentMicroWorkspaceState | null = null;
  private reconnectTimer: number | null = null;
  private livenessTimer: number | null = null;
  private phoneDropTimer: number | null = null;
  private reconnectAttempt = 0;
  private writeQueue = Promise.resolve();
  private workspaceWriteScheduled = false;
  private workspaceWriteDirty = false;
  private workspaceFlushTimer: number | null = null;
  private lastWorkspaceWriteAt = 0;
  private restorePromise: Promise<void> | null = null;
  private desktopTransportUnsubscribe: (() => void) | null = null;
  private desktopTransportRevision = -1;

  getSnapshot = (): AgentMicroRemoteSnapshot => this.snapshot;
  getWorkspaceState = (): AgentMicroWorkspaceState | null => this.workspaceState;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeCommands(listener: (command: AgentMicroCommand) => void): () => void {
    this.commandListeners.add(listener);
    return () => this.commandListeners.delete(listener);
  }

  async restore(): Promise<void> {
    if (this.restorePromise !== null) return this.restorePromise;
    const pending = this.restoreInternal();
    this.restorePromise = pending;
    try {
      await pending;
    } finally {
      if (this.restorePromise === pending) this.restorePromise = null;
    }
  }

  private async restoreInternal(): Promise<void> {
    const desktopTransport = this.desktopTransport();
    if (desktopTransport !== null) {
      if (this.desktopTransportUnsubscribe === null) {
        this.desktopTransportUnsubscribe = desktopTransport.onAgentMicroTransportEvent(
          this.handleDesktopTransportEvent,
        );
      }
      try {
        this.applyDesktopTransportState(await desktopTransport.getAgentMicroTransportState());
      } catch (error) {
        this.fail(error);
        this.scheduleReconnect();
      }
      return;
    }

    const bluetooth = this.bluetooth();
    if (
      !bluetooth ||
      !this.snapshot.autoReconnect ||
      this.snapshot.phase === "connected" ||
      this.snapshot.phase === "connecting" ||
      this.snapshot.phase === "scanning"
    ) {
      return;
    }
    try {
      const devices = bluetooth.getDevices ? await bluetooth.getDevices() : [];
      // The phone advertises "AgentMicro"; pre-rename builds advertised
      // "AgentMicro". Accept either so an older phone still reconnects.
      const saved =
        devices.find((device) => device.name === "AgentMicro" || device.name === "AgentMicro") ??
        devices[0];
      if (saved) {
        await this.connectDevice(saved);
        return;
      }
      await this.requestAndConnect(bluetooth, true);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        this.update({ phase: "disconnected", error: null });
        this.scheduleReconnect();
        return;
      }
      this.fail(error);
      this.scheduleReconnect();
    }
  }

  async pair(): Promise<void> {
    if (this.desktopTransport() !== null) {
      await this.restore();
      return;
    }
    const bluetooth = this.bluetooth();
    if (!bluetooth) {
      this.update({ phase: "unsupported", error: "Bluetooth is unavailable in this build." });
      return;
    }

    this.snapshot = { ...this.snapshot, autoReconnect: true };
    try {
      await this.requestAndConnect(bluetooth, false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        this.update({ phase: "disconnected", error: null });
        return;
      }
      this.fail(error);
    }
  }

  private async requestAndConnect(bluetooth: BluetoothLike, automatic: boolean): Promise<void> {
    this.update({
      phase: "scanning",
      error: automatic ? "Looking for the previously paired iPhone…" : null,
    });
    const device = await bluetooth.requestDevice({
      filters: [{ services: [AGENT_MICRO_SERVICE_UUID] }],
      optionalServices: [AGENT_MICRO_SERVICE_UUID],
    });
    await this.connectDevice(device);
  }

  disconnect(): void {
    this.clearReconnect();
    this.clearLiveness();
    this.clearPhoneDropGrace();
    this.snapshot = { ...this.snapshot, autoReconnect: true };
    if (this.desktopTransport() !== null) {
      // The native menu companion owns the shared Bluetooth link and recovers
      // it automatically. A renderer must never tear that link down.
      void this.restore();
      return;
    }
    this.device?.gatt?.disconnect();
    this.device = null;
    this.output = null;
    this.writeReport = null;
    this.lastSentWorkspaceState = null;
    this.decoder.reset();
    this.update({ phase: "disconnected", deviceName: null, error: null });
    this.scheduleReconnect();
  }

  setWorkspaceState(state: AgentMicroWorkspaceState): void {
    this.workspaceState = state;
    for (const listener of this.listeners) listener();
    if (this.snapshot.phase === "connected") {
      this.scheduleWorkspaceState();
    }
  }

  replayWorkspaceState(): void {
    this.clearWorkspaceFlush();
    // A replay exists precisely because the phone's view is in doubt (it just
    // switched pages, or asked for a refresh), so resend everything.
    this.lastSentWorkspaceState = null;
    this.enqueueWorkspaceState();
  }

  private bluetooth(): BluetoothLike | null {
    if (typeof navigator === "undefined") return null;
    return (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth ?? null;
  }

  private desktopTransport(): {
    getAgentMicroTransportState: () => Promise<DesktopAgentMicroTransportState>;
    sendAgentMicroTransportReport: (report: readonly number[]) => void;
    onAgentMicroTransportEvent: (
      listener: (event: DesktopAgentMicroTransportEvent) => void,
    ) => () => void;
  } | null {
    if (typeof window === "undefined") return null;
    const bridge = window.desktopBridge;
    if (
      bridge?.getAgentMicroTransportState === undefined ||
      bridge.sendAgentMicroTransportReport === undefined ||
      bridge.onAgentMicroTransportEvent === undefined
    ) {
      return null;
    }
    return {
      getAgentMicroTransportState: bridge.getAgentMicroTransportState,
      sendAgentMicroTransportReport: bridge.sendAgentMicroTransportReport,
      onAgentMicroTransportEvent: bridge.onAgentMicroTransportEvent,
    };
  }

  private readonly handleDesktopTransportEvent = (event: DesktopAgentMicroTransportEvent): void => {
    if (event.kind === "state") {
      this.applyDesktopTransportState(event.state);
      return;
    }
    if (this.snapshot.phase !== "connected") return;
    const report = Uint8Array.from(event.report);
    const body = report.byteLength === 64 && report[0] === 6 ? report.subarray(1) : report;
    this.ingestReport(body);
  };

  private applyDesktopTransportState(state: DesktopAgentMicroTransportState): void {
    if (state.revision <= this.desktopTransportRevision) return;
    this.desktopTransportRevision = state.revision;

    // A momentary "phone gone" while the companion itself is still up is
    // almost always a device re-presentation, not a real disconnect. Wait it
    // out: if the phone is back within the grace the session never notices,
    // and if it is really gone the teardown below runs a moment later.
    const stillLinked = state.companionConnected && state.phoneConnected;
    if (!stillLinked && state.companionConnected && this.snapshot.phase === "connected") {
      if (this.phoneDropTimer === null) {
        this.phoneDropTimer = window.setTimeout(() => {
          this.phoneDropTimer = null;
          this.applyDesktopTransportDisconnect(state);
        }, PHONE_DROP_GRACE_MS);
      }
      return;
    }
    const wasGraced = this.phoneDropTimer !== null;
    this.clearPhoneDropGrace();

    // The phone came back inside the grace, so nothing was ever torn down.
    // Rebuilding the session here would force a full workspace re-push on every
    // blip — invisible, but a needless multi-kilobyte write over BLE each time.
    if (wasGraced && stillLinked && this.desktopTransport() !== null) {
      return;
    }

    this.clearReconnect();
    this.clearLiveness();
    this.device = null;
    this.output = null;
    this.snapshot = { ...this.snapshot, autoReconnect: true };

    const transport = this.desktopTransport();
    if (state.companionConnected && state.phoneConnected && transport !== null) {
      this.writeReport = async (report) => {
        transport.sendAgentMicroTransportReport([...report]);
      };
      this.reconnectAttempt = 0;
      this.update({
        phase: "connected",
        deviceName: "AgentMicro",
        error: null,
      });
      // The companion may have reconnected to a different phone session, so
      // never assume it still holds the state we last sent.
      this.lastSentWorkspaceState = null;
      this.enqueueWorkspaceState();
      return;
    }

    this.applyDesktopTransportDisconnect(state);
  }

  private applyDesktopTransportDisconnect(state: DesktopAgentMicroTransportState): void {
    // Idempotent, and repeated here because the grace timer reaches this
    // without having gone through the caller's preamble.
    this.clearReconnect();
    this.clearLiveness();
    this.device = null;
    this.output = null;
    this.snapshot = { ...this.snapshot, autoReconnect: true };
    this.writeReport = null;
    this.lastSentWorkspaceState = null;
    this.decoder.reset();
    this.update({
      phase: "scanning",
      deviceName: state.companionConnected ? "AgentMicro" : null,
      error:
        state.error ??
        (state.companionConnected
          ? "AgentMicro is ready. Open the iPhone app to connect automatically."
          : "Opening the AgentMicro menu companion…"),
    });
  }

  private clearPhoneDropGrace(): void {
    if (this.phoneDropTimer !== null) {
      window.clearTimeout(this.phoneDropTimer);
      this.phoneDropTimer = null;
    }
  }

  private async connectDevice(device: BluetoothDeviceLike): Promise<void> {
    this.clearReconnect();
    this.device = device;
    this.snapshot = { ...this.snapshot, autoReconnect: true };
    this.update({ phase: "connecting", deviceName: device.name ?? "AgentMicro", error: null });

    const server = await device.gatt?.connect();
    if (!server) {
      throw new Error("The selected device does not expose a Bluetooth GATT server.");
    }
    const service = await server.getPrimaryService(AGENT_MICRO_SERVICE_UUID);
    const input = await service.getCharacteristic(AGENT_MICRO_INPUT_UUID);
    this.output = await service.getCharacteristic(AGENT_MICRO_OUTPUT_UUID);
    this.writeReport = async (report) => {
      const output = this.output;
      if (!output) throw new Error("The AgentMicro output channel is unavailable.");
      const value = report.slice().buffer;
      if (output.writeValueWithoutResponse) {
        await output.writeValueWithoutResponse(value);
      } else if (output.writeValue) {
        await output.writeValue(value);
      }
    };
    input.addEventListener("characteristicvaluechanged", this.handleNotification);
    await input.startNotifications();
    device.addEventListener("gattserverdisconnected", this.handleDisconnected);
    this.reconnectAttempt = 0;
    this.update({ phase: "connected", deviceName: device.name ?? "AgentMicro", error: null });
    this.notePhoneActivity();
    // A new link means the phone retained nothing: start from a full frame.
    this.lastSentWorkspaceState = null;
    this.enqueueWorkspaceState();
  }

  private readonly handleNotification = (event: Event): void => {
    const characteristic = event.currentTarget as BluetoothCharacteristicLike | null;
    if (!characteristic?.value) return;
    this.notePhoneActivity();
    this.ingestReport(characteristic.value);
  };

  private ingestReport(report: DataView | Uint8Array): void {
    for (const command of this.decoder.push(report)) {
      if (command.surface && command.surface !== "t3code") continue;
      if (command.commandID && this.isDuplicate(command.commandID)) continue;
      if (command.cmd === "deviceStatus") {
        const batteryPercent =
          typeof command.battery === "number"
            ? Math.min(100, Math.max(0, Math.round(command.battery)))
            : null;
        this.update({
          batteryPercent,
          charging: command.charging === true,
        });
        continue;
      }
      for (const listener of this.commandListeners) listener(command);
    }
  }

  private readonly handleDisconnected = (): void => {
    this.clearLiveness();
    this.output = null;
    this.writeReport = null;
    this.lastSentWorkspaceState = null;
    this.decoder.reset();
    this.update({ phase: "disconnected", error: null });
    this.scheduleReconnect();
  };

  private scheduleReconnect(): void {
    if (
      this.reconnectTimer !== null ||
      !this.snapshot.autoReconnect ||
      this.snapshot.phase === "connected" ||
      this.snapshot.phase === "connecting"
    ) {
      return;
    }
    const delay = Math.min(10_000, 500 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.device) {
        void this.connectDevice(this.device).catch((error) => {
          this.fail(error);
          this.scheduleReconnect();
        });
      } else {
        void this.restore();
      }
    }, delay);
  }

  private notePhoneActivity(): void {
    this.clearLiveness();
    this.livenessTimer = window.setTimeout(() => {
      this.livenessTimer = null;
      if (this.snapshot.phase !== "connected") return;
      this.update({
        phase: "disconnected",
        error: "The iPhone app stopped responding. Reconnecting automatically…",
      });
      this.device?.gatt?.disconnect();
      this.scheduleReconnect();
    }, 26_000);
  }

  private clearLiveness(): void {
    if (this.livenessTimer !== null) {
      window.clearTimeout(this.livenessTimer);
      this.livenessTimer = null;
    }
  }

  private enqueueWorkspaceState(): void {
    this.clearWorkspaceFlush();
    if (!this.workspaceState || !this.writeReport) return;
    if (this.workspaceWriteScheduled) {
      this.workspaceWriteDirty = true;
      return;
    }
    const state = this.workspaceState;
    const writeReport = this.writeReport;
    const baseline = this.lastSentWorkspaceState;
    const frame = buildWorkspaceStateFrame(state, baseline);
    if (isRedundantWorkspaceStateFrame(frame, baseline)) {
      this.workspaceWriteDirty = false;
      return;
    }
    this.workspaceWriteDirty = false;
    this.workspaceWriteScheduled = true;
    this.writeQueue = this.writeQueue
      .then(async () => {
        const reports = encodeReports(AGENT_MICRO_STATE_CHANNEL, frame);
        for (const report of reports) {
          await writeReport(report);
        }
        // A replay or a dropped link may have invalidated the baseline while
        // this frame was queued. Adopting `state` then would cancel the full
        // resync those paths asked for, so only advance an intact baseline.
        if (this.lastSentWorkspaceState === baseline) {
          this.lastSentWorkspaceState = state;
        }
        this.lastWorkspaceWriteAt = Date.now();
      })
      .catch((error) => {
        // A partially written frame leaves the phone in an unknown state, so
        // the next attempt must be a full resync rather than another delta.
        this.lastSentWorkspaceState = null;
        this.fail(error);
      })
      .finally(() => {
        this.workspaceWriteScheduled = false;
        if (
          this.workspaceWriteDirty ||
          this.workspaceState !== state ||
          this.writeReport !== writeReport
        ) {
          this.scheduleWorkspaceState();
        }
      });
  }

  private scheduleWorkspaceState(): void {
    if (!this.workspaceState || !this.writeReport) return;
    if (this.workspaceWriteScheduled) {
      this.workspaceWriteDirty = true;
      return;
    }
    if (this.workspaceFlushTimer !== null) return;
    const elapsed = Date.now() - this.lastWorkspaceWriteAt;
    const delay = Math.max(0, WORKSPACE_WRITE_INTERVAL_MS - elapsed);
    if (delay === 0) {
      this.enqueueWorkspaceState();
      return;
    }
    this.workspaceFlushTimer = window.setTimeout(() => {
      this.workspaceFlushTimer = null;
      this.enqueueWorkspaceState();
    }, delay);
  }

  private clearWorkspaceFlush(): void {
    if (this.workspaceFlushTimer !== null) {
      window.clearTimeout(this.workspaceFlushTimer);
      this.workspaceFlushTimer = null;
    }
  }

  private isDuplicate(commandId: string): boolean {
    const now = Date.now();
    for (const [id, timestamp] of this.recentCommandIds) {
      if (now - timestamp > 60_000) this.recentCommandIds.delete(id);
    }
    if (this.recentCommandIds.has(commandId)) return true;
    this.recentCommandIds.set(commandId, now);
    return false;
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private fail(error: unknown): void {
    this.update({
      phase: "error",
      error: error instanceof Error ? error.message : "Bluetooth connection failed.",
    });
  }

  private update(patch: Partial<AgentMicroRemoteSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export const agentMicroRemote = new AgentMicroRemote();
