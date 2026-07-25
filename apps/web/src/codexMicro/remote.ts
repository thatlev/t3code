import type {
  DesktopCodexMicroTransportEvent,
  DesktopCodexMicroTransportState,
} from "@t3tools/contracts";

import {
  CODEX_MICRO_INPUT_UUID,
  CODEX_MICRO_OUTPUT_UUID,
  CODEX_MICRO_SERVICE_UUID,
  CODEX_MICRO_STATE_CHANNEL,
  CodexMicroCommandDecoder,
  encodeReports,
  type CodexMicroCommand,
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

export type CodexMicroConnectionPhase =
  | "unsupported"
  | "disconnected"
  | "scanning"
  | "connecting"
  | "connected"
  | "error";

export type CodexMicroRemoteSnapshot = {
  readonly phase: CodexMicroConnectionPhase;
  readonly deviceName: string | null;
  readonly error: string | null;
  readonly autoReconnect: boolean;
  readonly batteryPercent: number | null;
  readonly charging: boolean;
};

export type CodexMicroWorkspaceState = {
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

const INITIAL_SNAPSHOT: CodexMicroRemoteSnapshot = {
  phase:
    typeof navigator !== "undefined" && "bluetooth" in navigator ? "disconnected" : "unsupported",
  deviceName: null,
  error: null,
  autoReconnect: true,
  batteryPercent: null,
  charging: false,
};

const WORKSPACE_WRITE_INTERVAL_MS = 100;

class CodexMicroRemote {
  private snapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private readonly commandListeners = new Set<(command: CodexMicroCommand) => void>();
  private readonly decoder = new CodexMicroCommandDecoder();
  private readonly recentCommandIds = new Map<string, number>();
  private device: BluetoothDeviceLike | null = null;
  private output: BluetoothCharacteristicLike | null = null;
  private writeReport: ((report: Uint8Array) => Promise<void>) | null = null;
  private workspaceState: CodexMicroWorkspaceState | null = null;
  private reconnectTimer: number | null = null;
  private livenessTimer: number | null = null;
  private reconnectAttempt = 0;
  private writeQueue = Promise.resolve();
  private workspaceWriteScheduled = false;
  private workspaceWriteDirty = false;
  private workspaceFlushTimer: number | null = null;
  private lastWorkspaceWriteAt = 0;
  private restorePromise: Promise<void> | null = null;
  private desktopTransportUnsubscribe: (() => void) | null = null;
  private desktopTransportRevision = -1;

  getSnapshot = (): CodexMicroRemoteSnapshot => this.snapshot;
  getWorkspaceState = (): CodexMicroWorkspaceState | null => this.workspaceState;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeCommands(listener: (command: CodexMicroCommand) => void): () => void {
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
        this.desktopTransportUnsubscribe = desktopTransport.onCodexMicroTransportEvent(
          this.handleDesktopTransportEvent,
        );
      }
      try {
        this.applyDesktopTransportState(await desktopTransport.getCodexMicroTransportState());
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
      const saved = devices.find((device) => device.name === "Codex Micro") ?? devices[0];
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
      filters: [{ services: [CODEX_MICRO_SERVICE_UUID] }],
      optionalServices: [CODEX_MICRO_SERVICE_UUID],
    });
    await this.connectDevice(device);
  }

  disconnect(): void {
    this.clearReconnect();
    this.clearLiveness();
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
    this.decoder.reset();
    this.update({ phase: "disconnected", deviceName: null, error: null });
    this.scheduleReconnect();
  }

  setWorkspaceState(state: CodexMicroWorkspaceState): void {
    this.workspaceState = state;
    for (const listener of this.listeners) listener();
    if (this.snapshot.phase === "connected") {
      this.scheduleWorkspaceState();
    }
  }

  replayWorkspaceState(): void {
    this.clearWorkspaceFlush();
    this.enqueueWorkspaceState();
  }

  private bluetooth(): BluetoothLike | null {
    if (typeof navigator === "undefined") return null;
    return (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth ?? null;
  }

  private desktopTransport(): {
    getCodexMicroTransportState: () => Promise<DesktopCodexMicroTransportState>;
    sendCodexMicroTransportReport: (report: readonly number[]) => void;
    onCodexMicroTransportEvent: (
      listener: (event: DesktopCodexMicroTransportEvent) => void,
    ) => () => void;
  } | null {
    if (typeof window === "undefined") return null;
    const bridge = window.desktopBridge;
    if (
      bridge?.getCodexMicroTransportState === undefined ||
      bridge.sendCodexMicroTransportReport === undefined ||
      bridge.onCodexMicroTransportEvent === undefined
    ) {
      return null;
    }
    return {
      getCodexMicroTransportState: bridge.getCodexMicroTransportState,
      sendCodexMicroTransportReport: bridge.sendCodexMicroTransportReport,
      onCodexMicroTransportEvent: bridge.onCodexMicroTransportEvent,
    };
  }

  private readonly handleDesktopTransportEvent = (event: DesktopCodexMicroTransportEvent): void => {
    if (event.kind === "state") {
      this.applyDesktopTransportState(event.state);
      return;
    }
    if (this.snapshot.phase !== "connected") return;
    const report = Uint8Array.from(event.report);
    const body = report.byteLength === 64 && report[0] === 6 ? report.subarray(1) : report;
    this.ingestReport(body);
  };

  private applyDesktopTransportState(state: DesktopCodexMicroTransportState): void {
    if (state.revision <= this.desktopTransportRevision) return;
    this.desktopTransportRevision = state.revision;
    this.clearReconnect();
    this.clearLiveness();
    this.device = null;
    this.output = null;
    this.snapshot = { ...this.snapshot, autoReconnect: true };

    const transport = this.desktopTransport();
    if (state.companionConnected && state.phoneConnected && transport !== null) {
      this.writeReport = async (report) => {
        transport.sendCodexMicroTransportReport([...report]);
      };
      this.reconnectAttempt = 0;
      this.update({
        phase: "connected",
        deviceName: "Codex Micro",
        error: null,
      });
      this.enqueueWorkspaceState();
      return;
    }

    this.writeReport = null;
    this.decoder.reset();
    this.update({
      phase: "scanning",
      deviceName: state.companionConnected ? "Codex Micro" : null,
      error:
        state.error ??
        (state.companionConnected
          ? "Codex Micro is ready. Open the iPhone app to connect automatically."
          : "Opening the Codex Micro menu companion…"),
    });
  }

  private async connectDevice(device: BluetoothDeviceLike): Promise<void> {
    this.clearReconnect();
    this.device = device;
    this.snapshot = { ...this.snapshot, autoReconnect: true };
    this.update({ phase: "connecting", deviceName: device.name ?? "Codex Micro", error: null });

    const server = await device.gatt?.connect();
    if (!server) {
      throw new Error("The selected device does not expose a Bluetooth GATT server.");
    }
    const service = await server.getPrimaryService(CODEX_MICRO_SERVICE_UUID);
    const input = await service.getCharacteristic(CODEX_MICRO_INPUT_UUID);
    this.output = await service.getCharacteristic(CODEX_MICRO_OUTPUT_UUID);
    this.writeReport = async (report) => {
      const output = this.output;
      if (!output) throw new Error("The Codex Micro output channel is unavailable.");
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
    this.update({ phase: "connected", deviceName: device.name ?? "Codex Micro", error: null });
    this.notePhoneActivity();
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
    this.workspaceWriteDirty = false;
    this.workspaceWriteScheduled = true;
    this.writeQueue = this.writeQueue
      .then(async () => {
        const reports = encodeReports(CODEX_MICRO_STATE_CHANNEL, state);
        for (const report of reports) {
          await writeReport(report);
        }
        this.lastWorkspaceWriteAt = Date.now();
      })
      .catch((error) => this.fail(error))
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

  private update(patch: Partial<CodexMicroRemoteSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export const codexMicroRemote = new CodexMicroRemote();
