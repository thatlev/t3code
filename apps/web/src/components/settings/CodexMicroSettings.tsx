import {
  BatteryChargingIcon,
  BatteryIcon,
  BluetoothIcon,
  BoltIcon,
  CircleAlertIcon,
  GitForkIcon,
  GlobeIcon,
  MicIcon,
  PanelLeftIcon,
  PinIcon,
  RotateCcwIcon,
  SendIcon,
  SquarePenIcon,
  TerminalIcon,
  WandSparklesIcon,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useSyncExternalStore } from "react";

import { resetCodexMicroPins } from "../../codexMicro/controller";
import {
  CODEX_MICRO_ACTIONS,
  getCodexMicroPreferences,
  resetCodexMicroPreferences,
  setCodexMicroPreferences,
  subscribeCodexMicroPreferences,
  type CodexMicroAction,
  type CodexMicroJoystickDirection,
} from "../../codexMicro/preferences";
import { codexMicroRemote } from "../../codexMicro/remote";
import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { SettingsPageContainer } from "./settingsLayout";

function SettingLine({
  title,
  description,
  control,
  compact = false,
}: {
  title: string;
  description?: string;
  control: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex min-h-11 flex-col justify-center gap-3 border-b border-border/70 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between ${
        compact ? "sm:min-h-11" : "sm:min-h-[3.75rem]"
      }`}
    >
      <div className="min-w-0 pr-3">
        <div className="text-[13px] font-medium leading-5 text-foreground">{title}</div>
        {description ? (
          <div className="max-w-[34rem] text-xs leading-[1.4] text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[13px] text-muted-foreground">
        {control}
      </div>
    </div>
  );
}

function DeviceKey({
  children,
  label,
  className = "",
  style,
}: {
  children?: ReactNode;
  label: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      aria-label={label}
      title={label}
      style={style}
      className={`flex min-w-0 items-center justify-center rounded-[10px] border border-[#484c58] bg-[#202228] text-[#f5f5f6] shadow-[0_2px_3px_rgba(0,0,0,0.3)] ${className}`}
    >
      {children}
    </div>
  );
}

function AgentKey({
  index,
  color,
  active,
  label,
}: {
  index: number;
  color: number;
  active: boolean;
  label: string;
}) {
  const hex = `#${color.toString(16).padStart(6, "0")}`;
  return (
    <DeviceKey
      label={`Agent ${index + 1}: ${label}`}
      className={active ? "border-white/30" : ""}
      {...(active
        ? {
            style: {
              background: `linear-gradient(145deg, color-mix(in srgb, ${hex} 82%, white), color-mix(in srgb, ${hex} 72%, black))`,
              boxShadow: `inset 0 0 7px color-mix(in srgb, ${hex} 45%, white), 0 2px 4px rgba(0,0,0,.32)`,
            },
          }
        : {})}
    >
      <span
        className="size-2.5 rounded-full"
        style={{
          backgroundColor: active ? hex : "#565862",
          boxShadow: active ? `0 0 8px ${hex}` : "inset 0 0 0 1px #6a6d78",
        }}
      />
    </DeviceKey>
  );
}

function ActionIcon({ action }: { action: CodexMicroAction }) {
  const className = "size-4.5";
  switch (action) {
    case "fast":
      return <BoltIcon className={className} />;
    case "new":
      return <SquarePenIcon className={className} />;
    case "pin":
      return <PinIcon className={className} />;
    case "fork":
      return <GitForkIcon className={className} />;
    case "send":
      return <SendIcon className={className} />;
    case "frontendMax":
      return <WandSparklesIcon className={className} />;
    case "browser":
      return <GlobeIcon className={className} />;
    case "terminal":
      return <TerminalIcon className={className} />;
    case "sideChat":
      return <PanelLeftIcon className={className} />;
  }
}

function CodexMicroPreview() {
  const workspaceState = useSyncExternalStore(
    codexMicroRemote.subscribe,
    codexMicroRemote.getWorkspaceState,
    codexMicroRemote.getWorkspaceState,
  );
  const targetById = new Map(workspaceState?.targets.map((target) => [target.id, target]));
  const preferences = useSyncExternalStore(
    subscribeCodexMicroPreferences,
    getCodexMicroPreferences,
    getCodexMicroPreferences,
  );

  const agent = (index: number) => {
    const slot = workspaceState?.slots[index];
    const pin = workspaceState?.pins[index] ?? null;
    const target = pin ? targetById.get(pin) : null;
    return (
      <AgentKey
        index={index}
        color={slot?.c ?? 0}
        active={(slot?.e ?? 0) !== 0 && (slot?.c ?? 0) !== 0}
        label={target?.label ?? "Unassigned"}
      />
    );
  };

  return (
    <div className="flex justify-center border-y border-border/70 py-5">
      <div
        className="grid aspect-square w-[240px] grid-rows-4 gap-[5px] rounded-[12px] border-2 border-[#30343e] bg-[#171a20] p-[10px] shadow-[inset_0_0_0_1px_#101217]"
        aria-label="Codex Micro control preview"
      >
        <div className="grid grid-cols-4 gap-[5px]">
          <DeviceKey
            label="Reasoning effort dial"
            className="rounded-full border-0 bg-[linear-gradient(135deg,#2b2f39_0_38%,#3e424d_39%_100%)]"
          />
          {agent(0)}
          {agent(1)}
          <DeviceKey label="Navigation joystick">
            <span className="size-7 rounded-full bg-[#101114] shadow-[inset_0_3px_5px_#050506,0_0_0_2px_#30333c]" />
          </DeviceKey>
        </div>
        <div className="grid grid-cols-4 gap-[5px]">
          {agent(2)}
          {agent(3)}
          {agent(4)}
          {agent(5)}
        </div>
        <div className="grid grid-cols-4 gap-[5px]">
          {preferences.actionKeys.map((action, index) => {
            const descriptor = CODEX_MICRO_ACTIONS.find((item) => item.value === action)!;
            return (
              <DeviceKey key={index} label={descriptor.label}>
                <ActionIcon action={action} />
              </DeviceKey>
            );
          })}
        </div>
        <div className="grid grid-cols-[50px_105px_50px] gap-[5px]">
          <div className="relative flex items-center justify-center" aria-label="Connection status">
            <span className="size-7 rounded-full bg-[#202228]" />
            <span className="absolute left-1.5 flex flex-col gap-0.5">
              <i className="size-1 rounded-full bg-emerald-400" />
              <i className="size-1 rounded-full bg-[#4f525a]" />
              <i className="size-1 rounded-full bg-[#4f525a]" />
            </span>
          </div>
          <DeviceKey label="Push to talk">
            <MicIcon className="size-5" />
          </DeviceKey>
          <DeviceKey label="Send prompt">
            <SendIcon className="size-4.5" />
          </DeviceKey>
        </div>
      </div>
    </div>
  );
}

function ActionSelect({
  value,
  label,
  onChange,
}: {
  value: CodexMicroAction;
  label: string;
  onChange: (value: CodexMicroAction) => void;
}) {
  return (
    <SetupSelect
      value={value}
      label={label}
      onChange={(value) => onChange(value as CodexMicroAction)}
    >
      {CODEX_MICRO_ACTIONS.map((action) => (
        <option key={action.value} value={action.value}>
          {action.label}
        </option>
      ))}
    </SetupSelect>
  );
}

function SetupSelect({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange?: (value: string) => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      className="h-7 min-w-40 rounded-lg border border-border bg-muted/45 px-3 text-[13px] text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </select>
  );
}

export function CodexMicroSettings() {
  const snapshot = useSyncExternalStore(
    codexMicroRemote.subscribe,
    codexMicroRemote.getSnapshot,
    codexMicroRemote.getSnapshot,
  );
  const workspaceState = useSyncExternalStore(
    codexMicroRemote.subscribe,
    codexMicroRemote.getWorkspaceState,
    codexMicroRemote.getWorkspaceState,
  );
  const preferences = useSyncExternalStore(
    subscribeCodexMicroPreferences,
    getCodexMicroPreferences,
    getCodexMicroPreferences,
  );
  const connected = snapshot.phase === "connected";
  const busy = snapshot.phase === "scanning" || snapshot.phase === "connecting";
  const connectionLabel =
    snapshot.phase === "scanning"
      ? "Looking for iPhone…"
      : snapshot.phase === "connecting"
        ? "Connecting…"
        : connected
          ? "Connected"
          : snapshot.phase === "unsupported"
            ? "Bluetooth unavailable"
            : snapshot.phase === "error"
              ? "Connection error"
              : "Not connected";
  const pinnedCount = workspaceState?.pins.filter(Boolean).length ?? 0;

  const resetLayout = () => {
    resetCodexMicroPins();
    resetCodexMicroPreferences();
  };

  return (
    <SettingsPageContainer className="max-w-3xl gap-12">
      <section>
        <h1 className="mb-7 text-2xl font-medium tracking-[-0.025em] text-foreground">
          Codex Micro
        </h1>

        <div className="rounded-2xl border border-border bg-card/70 px-4 sm:px-[17px]">
          <SettingLine
            compact
            title="Connection"
            control={
              <>
                <span className={snapshot.phase === "error" ? "text-destructive" : ""}>
                  {connectionLabel}
                </span>
                {isElectron ? (
                  connected ? (
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => codexMicroRemote.disconnect()}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void codexMicroRemote.pair()}
                    >
                      <BluetoothIcon className="size-3.5" />
                      Connect iPhone
                    </Button>
                  )
                ) : null}
              </>
            }
          />
          <SettingLine
            compact
            title="Battery"
            control={
              snapshot.batteryPercent === null ? (
                <span>—</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  {snapshot.charging ? (
                    <BatteryChargingIcon className="size-4 text-emerald-500" />
                  ) : (
                    <BatteryIcon className="size-4" />
                  )}
                  {snapshot.batteryPercent}%
                  {snapshot.charging ? <BoltIcon className="size-3.5 text-emerald-500" /> : null}
                </span>
              )
            }
          />
          <SettingLine
            title="Bluetooth access"
            description="Required for direct Codex Micro control from the iPhone"
            control={
              <span className="inline-flex items-center gap-2">
                {snapshot.phase === "unsupported" ? (
                  <>
                    <span className="text-destructive">Unavailable</span>
                    <CircleAlertIcon className="size-3.5 text-destructive" />
                  </>
                ) : (
                  <>
                    <span>{isElectron ? "Ready" : "Desktop app required"}</span>
                    <BluetoothIcon className="size-3.5" />
                  </>
                )}
              </span>
            }
          />
          <SettingLine
            title="Brightness"
            description="Adjusts the brightness of all Codex Micro lighting"
            control={
              <label className="flex items-center gap-4">
                <input
                  aria-label="Codex Micro brightness"
                  className="h-4 w-36 cursor-pointer accent-foreground"
                  type="range"
                  min="0"
                  max="100"
                  value={preferences.brightness}
                  onChange={(event) =>
                    setCodexMicroPreferences({ brightness: Number(event.target.value) })
                  }
                />
                <output className="w-9 text-right tabular-nums">{preferences.brightness}%</output>
              </label>
            }
          />
          <SettingLine
            title="Auto-dim"
            description="Turns lighting off after inactivity and back on with the next control or agent-state change"
            control={
              <SetupSelect
                label="Auto-dim delay"
                value={String(preferences.autoDimSeconds)}
                onChange={(value) => setCodexMicroPreferences({ autoDimSeconds: Number(value) })}
              >
                <option value="60">1 minute</option>
                <option value="180">3 minutes</option>
                <option value="300">5 minutes</option>
                <option value="0">Never</option>
              </SetupSelect>
            }
          />
          {snapshot.error ? (
            <div className="pb-3 text-xs text-destructive">{snapshot.error}</div>
          ) : null}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium text-foreground">Codex Micro Layout</h2>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={resetLayout}
          >
            <RotateCcwIcon className="size-3.5" />
            Reset layout
          </button>
        </div>

        <div className="rounded-2xl border border-border bg-card/70 px-4 sm:px-[17px]">
          <SettingLine
            title="Agent keys"
            description={`Agent 1–2 are the top row; Agent 3–6 continue left-to-right below · ${pinnedCount} pinned`}
            control={<span>Pinned tasks</span>}
          />
          <SettingLine
            title="Knob"
            description="Turn to change reasoning effort; hold to open Codex Micro settings"
            control={<span>Reasoning effort</span>}
          />

          <CodexMicroPreview />

          {preferences.actionKeys.map((action, index) => (
            <SettingLine
              key={`action-${index}`}
              title={`Action key ${index + 1}`}
              description={`Physical key ACT0${index + 6}, shown left-to-right on the third row`}
              control={
                <ActionSelect
                  label={`Action key ${index + 1}`}
                  value={action}
                  onChange={(value) => {
                    const next = [...preferences.actionKeys] as [
                      CodexMicroAction,
                      CodexMicroAction,
                      CodexMicroAction,
                      CodexMicroAction,
                    ];
                    next[index] = value;
                    setCodexMicroPreferences({ actionKeys: next });
                  }}
                />
              }
            />
          ))}
          {(["up", "right", "down", "left"] as const).map(
            (direction: CodexMicroJoystickDirection) => (
              <SettingLine
                key={`joystick-${direction}`}
                title={`Joystick ${direction}`}
                description={`Action triggered when the stick moves ${direction}`}
                control={
                  <ActionSelect
                    label={`Joystick ${direction}`}
                    value={preferences.joystick[direction]}
                    onChange={(value) =>
                      setCodexMicroPreferences({
                        joystick: { ...preferences.joystick, [direction]: value },
                      })
                    }
                  />
                }
              />
            ),
          )}
          <SettingLine
            title="Microphone key"
            description="Starts and stops macOS Dictation in the active T3 composer"
            control={<span>Mac Dictation</span>}
          />
        </div>
      </section>

      <div className="sr-only" aria-live="polite">
        {connected
          ? `Codex Micro connected${snapshot.deviceName ? ` to ${snapshot.deviceName}` : ""}.`
          : connectionLabel}
      </div>
    </SettingsPageContainer>
  );
}
