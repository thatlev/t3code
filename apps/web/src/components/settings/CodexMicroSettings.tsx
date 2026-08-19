import {
  BatteryChargingIcon,
  BatteryIcon,
  BluetoothIcon,
  BoltIcon,
  CheckIcon,
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
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useState, useSyncExternalStore } from "react";

import { resetCodexMicroPins } from "../../codexMicro/pins";
import {
  CODEX_MICRO_ACTIONS,
  CODEX_MICRO_DIAL_FUNCTIONS,
  getCodexMicroPreferences,
  resetCodexMicroPreferences,
  setCodexMicroPreferences,
  subscribeCodexMicroPreferences,
  type CodexMicroAction,
  type CodexMicroDialFunction,
  type CodexMicroJoystickDirection,
} from "../../codexMicro/preferences";
import { codexMicroRemote } from "../../codexMicro/remote";
import { isElectron } from "../../env";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { SettingsPageContainer } from "./settingsLayout";

const DEVICE_KEY_CLASS =
  "flex min-w-0 items-center justify-center rounded-[10px] border border-[#484c58] bg-[#202228] text-[#f5f5f6] shadow-[0_2px_3px_rgba(0,0,0,0.3)]";

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
      className={`${DEVICE_KEY_CLASS} ${className}`}
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
    case "clear":
      return <Trash2Icon className={className} />;
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

function ActionPicker({
  title,
  value,
  onChange,
}: {
  title: string;
  value: CodexMicroAction;
  onChange: (value: CodexMicroAction) => void;
}) {
  return (
    <div className="w-56 p-1">
      <PopoverTitle className="px-2 pb-2 pt-1 text-xs font-medium text-muted-foreground">
        {title}
      </PopoverTitle>
      <div className="grid gap-0.5">
        {CODEX_MICRO_ACTIONS.map((action) => (
          <button
            key={action.value}
            type="button"
            className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
            onClick={() => onChange(action.value)}
          >
            <ActionIcon action={action.value} />
            <span className="flex-1">{action.label}</span>
            {action.value === value ? <CheckIcon className="size-3.5 text-blue-500" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function EditableActionKey({
  index,
  value,
  onChange,
}: {
  index: number;
  value: CodexMicroAction;
  onChange: (value: CodexMicroAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const descriptor = CODEX_MICRO_ACTIONS.find((item) => item.value === value)!;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Action key ${index + 1}: ${descriptor.label}. Click to change.`}
        title={`${descriptor.label} · Click to change`}
        className={`${DEVICE_KEY_CLASS} cursor-pointer outline-none transition-[border-color,background-color,transform] hover:border-blue-400/80 hover:bg-[#272b34] focus-visible:ring-2 focus-visible:ring-blue-400 data-popup-open:border-blue-400 data-popup-open:bg-[#272b34]`}
      >
        <ActionIcon action={value} />
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="center" sideOffset={8} viewportClassName="p-1">
        <ActionPicker
          title={`Action key ${index + 1}`}
          value={value}
          onChange={(action) => {
            onChange(action);
            setOpen(false);
          }}
        />
      </PopoverPopup>
    </Popover>
  );
}

function EditableJoystick({
  value,
  onChange,
}: {
  value: Readonly<Record<CodexMicroJoystickDirection, CodexMicroAction>>;
  onChange: (direction: CodexMicroJoystickDirection, action: CodexMicroAction) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Navigation joystick. Click to change directional actions."
        title="Joystick · Click to change"
        className={`${DEVICE_KEY_CLASS} cursor-pointer outline-none transition-[border-color,background-color] hover:border-blue-400/80 hover:bg-[#272b34] focus-visible:ring-2 focus-visible:ring-blue-400 data-popup-open:border-blue-400 data-popup-open:bg-[#272b34]`}
      >
        <span className="size-7 rounded-full bg-[#101114] shadow-[inset_0_3px_5px_#050506,0_0_0_2px_#30333c]" />
      </PopoverTrigger>
      <PopoverPopup side="right" align="start" sideOffset={8} viewportClassName="p-2">
        <div className="w-72 p-1">
          <div className="px-2 pb-2 pt-1">
            <PopoverTitle className="text-sm font-medium text-foreground">
              Analog stick
            </PopoverTitle>
            <div className="text-xs text-muted-foreground">Choose what each direction triggers</div>
          </div>
          <div className="grid gap-1">
            {(["up", "right", "down", "left"] as const).map((direction) => (
              <label
                key={direction}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[13px] capitalize text-foreground hover:bg-accent/60"
              >
                <span>{direction}</span>
                <ActionSelect
                  label={`Joystick ${direction}`}
                  value={value[direction]}
                  onChange={(action) => onChange(direction, action)}
                />
              </label>
            ))}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
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
        aria-label="AgentMicro control preview"
      >
        <div className="grid grid-cols-4 gap-[5px]">
          <DeviceKey
            label="Reasoning effort dial"
            className="rounded-full border-0 bg-[linear-gradient(135deg,#2b2f39_0_38%,#3e424d_39%_100%)]"
          />
          {agent(0)}
          {agent(1)}
          <EditableJoystick
            value={preferences.joystick}
            onChange={(direction, action) =>
              setCodexMicroPreferences({
                joystick: { ...preferences.joystick, [direction]: action },
              })
            }
          />
        </div>
        <div className="grid grid-cols-4 gap-[5px]">
          {agent(2)}
          {agent(3)}
          {agent(4)}
          {agent(5)}
        </div>
        <div className="grid grid-cols-4 gap-[5px]">
          {preferences.actionKeys.map((action, index) => (
            <EditableActionKey
              key={index}
              index={index}
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
          ))}
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
          <DeviceKey
            label={workspaceState?.nativeVoiceActive ? "macOS Dictation active" : "Push to talk"}
            className={
              workspaceState?.nativeVoiceActive
                ? "border-emerald-400/80 bg-emerald-500/20 text-emerald-300"
                : ""
            }
          >
            <MicIcon
              className={`size-5 ${workspaceState?.nativeVoiceActive ? "animate-pulse" : ""}`}
            />
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
          AgentMicro
        </h1>

        <div className="rounded-2xl border border-border bg-card/70 px-4 sm:px-[17px]">
          <SettingLine
            compact
            title="Connection"
            control={
              <span className={snapshot.phase === "error" ? "text-destructive" : ""}>
                {connectionLabel}
              </span>
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
            title="Automatic connection"
            description="T3 Code uses the AgentMicro menu companion and reconnects after launch, sleep, and reloads"
            control={
              <span className="inline-flex items-center gap-2">
                {snapshot.phase === "unsupported" ? (
                  <>
                    <span className="text-destructive">Unavailable</span>
                    <CircleAlertIcon className="size-3.5 text-destructive" />
                  </>
                ) : (
                  <>
                    <span>{isElectron ? (busy ? "Starting" : "On") : "Desktop app required"}</span>
                    <BluetoothIcon className="size-3.5" />
                  </>
                )}
              </span>
            }
          />
          <SettingLine
            title="Brightness"
            description="Adjusts the brightness of all AgentMicro lighting"
            control={
              <label className="flex items-center gap-4">
                <input
                  aria-label="AgentMicro brightness"
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
          <h2 className="text-sm font-medium text-foreground">AgentMicro Layout</h2>
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
            title="Auto-pin new chats"
            description="Pin a chat after its first message is sent. Every chat can still be unpinned."
            control={
              <Switch
                checked={preferences.autoPinNewChats}
                onCheckedChange={(checked) =>
                  setCodexMicroPreferences({ autoPinNewChats: checked })
                }
                aria-label="Auto-pin new chats"
              />
            }
          />
          <SettingLine
            title="Agent keys"
            description={`Agent 1–2 are the top row; Agent 3–6 continue left-to-right below · ${pinnedCount} pinned`}
            control={
              pinnedCount > 0 ? (
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={resetCodexMicroPins}
                >
                  Clear all
                </button>
              ) : (
                <span>None pinned</span>
              )
            }
          />
          <SettingLine
            title="Knob"
            description={`${
              CODEX_MICRO_DIAL_FUNCTIONS.find((entry) => entry.value === preferences.dialFunction)
                ?.description ?? ""
            } Hold to open AgentMicro settings.`}
            control={
              <SetupSelect
                label="Knob function"
                value={preferences.dialFunction}
                onChange={(value) =>
                  setCodexMicroPreferences({ dialFunction: value as CodexMicroDialFunction })
                }
              >
                {CODEX_MICRO_DIAL_FUNCTIONS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </SetupSelect>
            }
          />

          <CodexMicroPreview />

          <div className="border-b border-border/70 py-3 text-center text-xs text-muted-foreground">
            Click an action key or the joystick in the preview to change it.
          </div>
          <SettingLine
            title="Microphone key"
            description="Starts and stops macOS Dictation in the active T3 composer"
            control={<span>Mac Dictation</span>}
          />
        </div>
      </section>

      <div className="sr-only" aria-live="polite">
        {connected
          ? `AgentMicro connected${snapshot.deviceName ? ` to ${snapshot.deviceName}` : ""}.`
          : connectionLabel}
      </div>
    </SettingsPageContainer>
  );
}
