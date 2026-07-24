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

class CodexMicroRemote {
  private snapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private readonly commandListeners = new Set<(command: CodexMicroCommand) => void>();
  private readonly decoder = new CodexMicroCommandDecoder();
  private readonly recentCommandIds = new Map<string, number>();
  private device: BluetoothDeviceLike | null = null;
  private output: BluetoothCharacteristicLike | null = null;
  private workspaceState: CodexMicroWorkspaceState | null = null;
  private reconnectTimer: number | null = null;
  private livenessTimer: number | null = null;
  private reconnectAttempt = 0;
  private writeQueue = Promise.resolve();

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
    const bluetooth = this.bluetooth();
    if (
      !bluetooth?.getDevices ||
      this.snapshot.phase === "connected" ||
      this.snapshot.phase === "connecting"
    ) {
      return;
    }
    try {
      const devices = await bluetooth.getDevices();
      const saved = devices.find((device) => device.name === "Codex Micro") ?? devices[0];
      if (saved) {
        await this.connectDevice(saved);
      }
    } catch (error) {
      this.fail(error);
      this.scheduleReconnect();
    }
  }

  async pair(): Promise<void> {
    const bluetooth = this.bluetooth();
    if (!bluetooth) {
      this.update({ phase: "unsupported", error: "Bluetooth is unavailable in this build." });
      return;
    }

    this.update({ phase: "scanning", error: null });
    try {
      const device = await bluetooth.requestDevice({
        filters: [{ services: [CODEX_MICRO_SERVICE_UUID] }],
        optionalServices: [CODEX_MICRO_SERVICE_UUID],
      });
      await this.connectDevice(device);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        this.update({ phase: "disconnected", error: null });
        return;
      }
      this.fail(error);
    }
  }

  disconnect(): void {
    this.clearReconnect();
    this.clearLiveness();
    this.snapshot = { ...this.snapshot, autoReconnect: false };
    this.device?.gatt?.disconnect();
    this.device = null;
    this.output = null;
    this.decoder.reset();
    this.update({ phase: "disconnected", deviceName: null, error: null });
  }

  setWorkspaceState(state: CodexMicroWorkspaceState): void {
    this.workspaceState = state;
    for (const listener of this.listeners) listener();
    if (this.snapshot.phase === "connected") {
      this.enqueueWorkspaceState();
    }
  }

  replayWorkspaceState(): void {
    this.enqueueWorkspaceState();
  }

  private bluetooth(): BluetoothLike | null {
    if (typeof navigator === "undefined") return null;
    return (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth ?? null;
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
    for (const command of this.decoder.push(characteristic.value)) {
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
  };

  private readonly handleDisconnected = (): void => {
    this.clearLiveness();
    this.output = null;
    this.decoder.reset();
    this.update({ phase: "disconnected", error: null });
    this.scheduleReconnect();
  };

  private scheduleReconnect(): void {
    if (
      this.reconnectTimer !== null ||
      !this.snapshot.autoReconnect ||
      !this.device ||
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
    if (!this.workspaceState || !this.output) return;
    const reports = encodeReports(CODEX_MICRO_STATE_CHANNEL, this.workspaceState);
    this.writeQueue = this.writeQueue
      .then(async () => {
        const output = this.output;
        if (!output) return;
        for (const report of reports) {
          const value = report.slice().buffer;
          if (output.writeValueWithoutResponse) {
            await output.writeValueWithoutResponse(value);
          } else if (output.writeValue) {
            await output.writeValue(value);
          }
        }
      })
      .catch((error) => this.fail(error));
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
