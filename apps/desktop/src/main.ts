// @effect-diagnostics nodeBuiltinImport:off - macOS Dictation requires an OS automation boundary.
// @effect-diagnostics globalDate:off - Companion launch throttling is local Electron lifecycle state.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "EPIPE") throw err;
  });
}

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeOS from "node:os";
import { execFile } from "node:child_process";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Electron from "electron";

import * as NetService from "@t3tools/shared/Net";
import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { resolveRemoteT3CliPackageSpec } from "@t3tools/ssh/command";
import type { RemoteT3RunnerOptions } from "@t3tools/ssh/tunnel";
import serverPackageJson from "../../server/package.json" with { type: "json" };

import * as DesktopIpc from "./ipc/DesktopIpc.ts";
import * as ElectronApp from "./electron/ElectronApp.ts";
import * as ElectronDialog from "./electron/ElectronDialog.ts";
import * as ElectronMenu from "./electron/ElectronMenu.ts";
import * as ElectronPowerMonitor from "./electron/ElectronPowerMonitor.ts";
import * as ElectronProtocol from "./electron/ElectronProtocol.ts";
import * as ElectronSafeStorage from "./electron/ElectronSafeStorage.ts";
import * as ElectronShell from "./electron/ElectronShell.ts";
import * as ElectronTheme from "./electron/ElectronTheme.ts";
import * as ElectronUpdater from "./electron/ElectronUpdater.ts";
import * as ElectronWindow from "./electron/ElectronWindow.ts";
import * as DesktopApp from "./app/DesktopApp.ts";
import * as DesktopAppIdentity from "./app/DesktopAppIdentity.ts";
import * as DesktopConnectionCatalogStore from "./app/DesktopConnectionCatalogStore.ts";
import * as DesktopClerk from "./app/DesktopClerk.ts";
import * as DesktopApplicationMenu from "./window/DesktopApplicationMenu.ts";
import * as DesktopAssets from "./app/DesktopAssets.ts";
import * as DesktopBackendConfiguration from "./backend/DesktopBackendConfiguration.ts";
import * as DesktopBackendPool from "./backend/DesktopBackendPool.ts";
import * as DesktopLocalEnvironmentAuth from "./backend/DesktopLocalEnvironmentAuth.ts";
import * as DesktopNetworkInterfaces from "./backend/DesktopNetworkInterfaces.ts";
import * as DesktopEnvironment from "./app/DesktopEnvironment.ts";
import * as DesktopLifecycle from "./app/DesktopLifecycle.ts";
import * as DesktopKeepAwake from "./app/DesktopKeepAwake.ts";
import * as DesktopLinuxUrlHandler from "./app/DesktopLinuxUrlHandler.ts";
import * as DesktopShutdown from "./app/DesktopShutdown.ts";
import * as DesktopObservability from "./app/DesktopObservability.ts";
import * as DesktopServerExposure from "./backend/DesktopServerExposure.ts";
import * as DesktopClientSettings from "./settings/DesktopClientSettings.ts";
import * as DesktopSavedEnvironments from "./settings/DesktopSavedEnvironments.ts";
import * as DesktopAppSettings from "./settings/DesktopAppSettings.ts";
import * as DesktopPreReadyPlatform from "./app/DesktopPreReadyPlatform.ts";
import * as DesktopShellEnvironment from "./shell/DesktopShellEnvironment.ts";
import * as DesktopSshEnvironment from "./ssh/DesktopSshEnvironment.ts";
import * as DesktopSshPasswordPrompts from "./ssh/DesktopSshPasswordPrompts.ts";
import * as DesktopState from "./app/DesktopState.ts";
import * as DesktopTelemetryPublisher from "./telemetry/DesktopTelemetryPublisher.ts";
import * as DesktopUpdates from "./updates/DesktopUpdates.ts";
import * as BrowserSession from "./preview/BrowserSession.ts";
import * as PreviewManager from "./preview/Manager.ts";
import * as DesktopThreadWindows from "./window/DesktopThreadWindows.ts";
import * as DesktopWindow from "./window/DesktopWindow.ts";
import * as DesktopWslBackend from "./wsl/DesktopWslBackend.ts";
import * as DesktopWslEnvironment from "./wsl/DesktopWslEnvironment.ts";
import {
  CodexMicroCompanionTransport,
  type CodexMicroCompanionTransportState,
} from "./codexMicro/CodexMicroCompanionTransport.ts";
import {
  buildMacDictationScript,
  MAC_DICTATION_ACCESSIBILITY_ERROR,
  parseMacDictationResult,
} from "./dictation/MacDictation.ts";
import * as IpcChannels from "./ipc/channels.ts";

const CODEX_MICRO_COMMAND_CHANNEL = "desktop:codex-micro-command";
const SET_MAC_DICTATION_CHANNEL = "desktop:set-mac-dictation";

/**
 * The one window that speaks to the Codex Micro remote.
 *
 * The pad is a single physical device with a single board, so exactly one
 * renderer may drive it. Fanning its input out to every window made each of
 * them act on the same key press — they all navigated to the pinned chat, and
 * since showing a chat is what claims it, torn-off chats got yanked back into
 * whichever window answered last. Its board is published the same way: two
 * authors would fight over the pins and lighting.
 */
function codexMicroHostWindow(): Electron.BrowserWindow | null {
  const catchAll = DesktopThreadWindows.desktopThreadWindows.catchAllWindow();
  if (catchAll !== null) return catchAll;
  // Every window is a torn-off one (the main window was closed): fall back to
  // the window the user is in so the pad still does something.
  const fallback =
    Electron.BrowserWindow.getFocusedWindow() ?? Electron.BrowserWindow.getAllWindows()[0];
  return fallback !== undefined && !fallback.isDestroyed() ? fallback : null;
}

function isCodexMicroHost(webContentsId: number): boolean {
  return codexMicroHostWindow()?.webContents.id === webContentsId;
}

function broadcastCodexMicroTransportEvent(value: unknown): void {
  const host = codexMicroHostWindow();
  if (host === null) return;
  host.webContents.send(IpcChannels.CODEX_MICRO_TRANSPORT_EVENT_CHANNEL, value);
}

let lastCompanionLaunchAttemptAt = 0;
function openCodexMicroCompanion(): void {
  if (process.platform !== "darwin") return;
  const now = Date.now();
  if (now - lastCompanionLaunchAttemptAt < 30_000) return;
  lastCompanionLaunchAttemptAt = now;
  void Electron.app.whenReady().then(
    () =>
      new Promise<void>((resolve) => {
        execFile("/usr/bin/open", ["-gj", "-b", "io.github.thislev.codexmicro"], () => resolve());
      }),
  );
}

const codexMicroCompanionTransport = new CodexMicroCompanionTransport({
  onState: (state: CodexMicroCompanionTransportState) => {
    broadcastCodexMicroTransportEvent({ kind: "state", state });
  },
  onInput: (report) => {
    broadcastCodexMicroTransportEvent({ kind: "input", report: [...report] });
  },
  onCompanionUnavailable: openCodexMicroCompanion,
});

Electron.ipcMain.removeHandler(IpcChannels.CODEX_MICRO_TRANSPORT_GET_STATE_CHANNEL);
Electron.ipcMain.handle(IpcChannels.CODEX_MICRO_TRANSPORT_GET_STATE_CHANNEL, (event) =>
  // A non-host window is told the pad is absent, so it never starts writing to
  // a device another window already owns.
  isCodexMicroHost(event.sender.id)
    ? codexMicroCompanionTransport.getState()
    : { revision: 0, companionConnected: false, phoneConnected: false, error: null },
);
Electron.ipcMain.removeAllListeners(IpcChannels.CODEX_MICRO_TRANSPORT_SEND_REPORT_CHANNEL);
Electron.ipcMain.on(
  IpcChannels.CODEX_MICRO_TRANSPORT_SEND_REPORT_CHANNEL,
  (event, value: unknown) => {
    if (
      !isCodexMicroHost(event.sender.id) ||
      !Array.isArray(value) ||
      (value.length !== 63 && value.length !== 64) ||
      value.some(
        (byte) => typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255,
      )
    ) {
      return;
    }
    codexMicroCompanionTransport.send(Uint8Array.from(value as number[]));
  },
);
codexMicroCompanionTransport.start();
Electron.app.once("before-quit", () => codexMicroCompanionTransport.stop());

let macDictationActive = false;
let macDictationQueue = Promise.resolve({
  active: false,
  error: null as string | null,
});

function runAppleScript(source: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/osascript", ["-e", source], (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

Electron.ipcMain.removeHandler(SET_MAC_DICTATION_CHANNEL);
Electron.ipcMain.handle(SET_MAC_DICTATION_CHANNEL, (_event, requested: unknown) => {
  const active = requested === true;
  macDictationQueue = macDictationQueue.then(async () => {
    if (process.platform !== "darwin") {
      return { active: false, error: "macOS Dictation is only available on macOS." };
    }
    if (!Electron.systemPreferences.isTrustedAccessibilityClient(true)) {
      return { active: macDictationActive, error: MAC_DICTATION_ACCESSIBILITY_ERROR };
    }

    const windows = Electron.BrowserWindow.getAllWindows();
    for (const window of windows) {
      window.show();
      window.focus();
    }
    Electron.app.focus({ steal: true });

    try {
      const result = await runAppleScript(buildMacDictationScript(Electron.app.name, active));
      macDictationActive = parseMacDictationResult(result);
      return { active: macDictationActive, error: null };
    } catch {
      return {
        active: macDictationActive,
        error:
          "Could not toggle macOS Dictation. Enable Dictation in Keyboard settings and allow T3 Code in Privacy & Security > Accessibility.",
      };
    }
  });
  return macDictationQueue;
});

function parseCodexMicroUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "t3code:" && url.protocol !== "t3code-dev:") ||
      url.hostname !== "codex-micro" ||
      url.pathname !== "/command"
    ) {
      return null;
    }
    const kind = url.searchParams.get("kind");
    if (kind === "effort") {
      return {
        kind: "effort" as const,
        direction: url.searchParams.get("direction") === "-1" ? (-1 as const) : (1 as const),
      };
    }
    if (kind === "focus") {
      const environmentId = url.searchParams.get("environmentId");
      const threadId = url.searchParams.get("threadId");
      return {
        kind: "focus" as const,
        ...(environmentId ? { environmentId } : {}),
        ...(threadId ? { threadId } : {}),
      };
    }
    if (kind === "action") {
      const action = url.searchParams.get("action");
      if (
        action === "fast" ||
        action === "new" ||
        action === "fork" ||
        action === "clear" ||
        action === "send" ||
        action === "frontendMax" ||
        action === "browser" ||
        action === "terminal" ||
        action === "sideChat" ||
        action === "settings"
      ) {
        return { kind: "action" as const, action };
      }
    }
  } catch {
    // Ignore malformed or unrelated protocol URLs.
  }
  return null;
}

const pendingCodexMicroCommands: Array<NonNullable<ReturnType<typeof parseCodexMicroUrl>>> = [];

// Remote commands act on exactly one window. Broadcasting them made every open
// window jump to the same chat; a "focus" goes to the window that actually
// holds that chat, and everything else goes to the window the user is in.
function resolveCodexMicroTargetWindow(
  command: NonNullable<ReturnType<typeof parseCodexMicroUrl>>,
  windows: readonly Electron.BrowserWindow[],
): Electron.BrowserWindow | undefined {
  if (command.kind === "focus" && command.environmentId && command.threadId) {
    const owner = DesktopThreadWindows.desktopThreadWindows.windowForThread(
      DesktopThreadWindows.desktopThreadKey({
        environmentId: command.environmentId,
        threadId: command.threadId,
      }),
    );
    if (owner !== null) return owner;
    // Unclaimed chats live in the catch-all window, whatever it is called.
    const catchAll = windows.find(
      (window) =>
        !window.isDestroyed() &&
        !DesktopThreadWindows.desktopThreadWindows.isScopedWindow(window.webContents.id),
    );
    if (catchAll !== undefined) return catchAll;
  }
  return Electron.BrowserWindow.getFocusedWindow() ?? windows[0];
}

function dispatchCodexMicroUrl(value: string) {
  const command = parseCodexMicroUrl(value);
  if (command === null) return;
  const windows = Electron.BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    pendingCodexMicroCommands.push(command);
    return;
  }
  const target = resolveCodexMicroTargetWindow(command, windows);
  if (target === undefined || target.isDestroyed()) return;
  Electron.app.focus({ steal: true });
  target.show();
  target.focus();
  target.webContents.send(CODEX_MICRO_COMMAND_CHANNEL, command);
}

Electron.app.on("open-url", (event, url) => {
  event.preventDefault();
  dispatchCodexMicroUrl(url);
});
Electron.app.on("second-instance", (_event, argv) => {
  for (const value of argv) dispatchCodexMicroUrl(value);
});
Electron.app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", () => {
    for (const command of pendingCodexMicroCommands.splice(0)) {
      window.webContents.send(CODEX_MICRO_COMMAND_CHANNEL, command);
    }
  });
});
for (const value of process.argv) {
  if (value.startsWith("t3code:") || value.startsWith("t3code-dev:")) {
    dispatchCodexMicroUrl(value);
  }
}

Electron.protocol.registerSchemesAsPrivileged([
  {
    scheme: ElectronProtocol.DESKTOP_PRODUCTION_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: ElectronProtocol.DESKTOP_DEVELOPMENT_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

const desktopEnvironmentLayer = Layer.unwrap(
  Effect.gen(function* () {
    const metadata = yield* Effect.service(ElectronApp.ElectronApp).pipe(
      Effect.flatMap((app) => app.metadata),
    );
    const platform = yield* HostProcessPlatform;
    const processArch = yield* HostProcessArchitecture;
    return DesktopEnvironment.layer({
      dirname: __dirname,
      homeDirectory: NodeOS.homedir(),
      platform,
      processArch,
      ...metadata,
    });
  }),
);

const resolveDesktopSshCliRunner = (
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
  settings: DesktopAppSettings.DesktopSettings,
): RemoteT3RunnerOptions => {
  const devRemoteEntryPath = Option.getOrUndefined(environment.devRemoteT3ServerEntryPath);
  if (environment.isDevelopment && devRemoteEntryPath !== undefined) {
    return {
      nodeScriptPath: devRemoteEntryPath,
      nodeEngineRange: serverPackageJson.engines.node,
    };
  }
  return {
    packageSpec: resolveRemoteT3CliPackageSpec({
      appVersion: environment.appVersion,
      updateChannel: settings.updateChannel,
      isDevelopment: environment.isDevelopment,
    }),
    nodeEngineRange: serverPackageJson.engines.node,
  };
};

const desktopSshEnvironmentLayer = Layer.unwrap(
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const settings = yield* DesktopAppSettings.DesktopAppSettings;
    return DesktopSshEnvironment.layer({
      resolveCliRunner: settings.get.pipe(
        Effect.map((currentSettings) => resolveDesktopSshCliRunner(environment, currentSettings)),
      ),
    });
  }),
);

const electronLayer = Layer.mergeAll(
  ElectronApp.layer,
  ElectronDialog.layer,
  ElectronMenu.layer,
  ElectronPowerMonitor.layer,
  ElectronProtocol.layer,
  ElectronSafeStorage.layer,
  ElectronShell.layer,
  ElectronTheme.layer,
  ElectronUpdater.layer,
  ElectronWindow.layer,
  DesktopIpc.layer(Electron.ipcMain),
);

const desktopFoundationLayer = Layer.mergeAll(
  DesktopState.layer,
  DesktopShutdown.layer,
  DesktopAppSettings.layer,
  DesktopClientSettings.layer,
  DesktopConnectionCatalogStore.layer.pipe(Layer.provideMerge(DesktopSavedEnvironments.layer)),
  DesktopAssets.layer,
  DesktopObservability.layer,
  DesktopKeepAwake.layer,
).pipe(Layer.provideMerge(desktopEnvironmentLayer));

const desktopSshLayer = desktopSshEnvironmentLayer.pipe(
  Layer.provideMerge(DesktopSshPasswordPrompts.layer()),
);

const desktopServerExposureLayer = DesktopServerExposure.layer.pipe(
  Layer.provideMerge(DesktopNetworkInterfaces.layer),
  Layer.provideMerge(desktopFoundationLayer),
);

const desktopPreviewLayer = PreviewManager.layer.pipe(
  Layer.provideMerge(BrowserSession.layer),
  Layer.provideMerge(desktopFoundationLayer),
);

const desktopWindowLayer = DesktopWindow.layer.pipe(
  Layer.provideMerge(desktopServerExposureLayer),
  Layer.provideMerge(desktopPreviewLayer),
);

// Pool layer instantiates the backend factory once for the Windows
// primary instance and exposes it via pool.primary. Consumers go through
// the pool now; the legacy DesktopBackendManager service is gone. The
// WSL second instance gets registered later in the migration. See
// DesktopBackendPool.ts header for the full rollout plan.
const desktopBackendLayer = DesktopBackendPool.layer.pipe(
  Layer.provideMerge(DesktopAppIdentity.layer),
  Layer.provideMerge(DesktopBackendConfiguration.layer),
  Layer.provideMerge(DesktopWslEnvironment.layer),
  Layer.provideMerge(DesktopTelemetryPublisher.layer),
  Layer.provideMerge(desktopWindowLayer),
);

// WSL orchestrator hangs off the backend layer because it needs the
// pool + configuration + serverExposure; it pulls NetService and the
// foundation services through the same provideMerge chain.
const desktopWslBackendLayer = DesktopWslBackend.layer.pipe(
  Layer.provideMerge(desktopBackendLayer),
);

const desktopLocalEnvironmentAuthLayer = DesktopLocalEnvironmentAuth.layer.pipe(
  Layer.provideMerge(desktopBackendLayer),
);

const desktopApplicationLayer = Layer.mergeAll(
  DesktopLifecycle.layer,
  DesktopApplicationMenu.layer,
  DesktopLinuxUrlHandler.layer,
  DesktopShellEnvironment.layer,
  desktopSshLayer,
).pipe(
  Layer.provideMerge(DesktopUpdates.layer),
  Layer.provideMerge(desktopWslBackendLayer),
  Layer.provideMerge(desktopLocalEnvironmentAuthLayer),
);

const desktopClerkLayer = DesktopClerk.layer.pipe(
  Layer.provideMerge(desktopEnvironmentLayer),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(ElectronApp.layer),
);

const desktopApplicationRuntimeLayer = desktopApplicationLayer.pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(NodeHttpClient.layerUndici),
  Layer.provideMerge(NetService.layer),
  Layer.provideMerge(electronLayer),
);

// Acquire strict pre-ready setup before Clerk, whose userData resolution can
// yield and let Electron emit ready.
const desktopRuntimeLayer = desktopClerkLayer.pipe(
  Layer.flatMap((clerkContext) =>
    desktopApplicationRuntimeLayer.pipe(Layer.provideMerge(Layer.succeedContext(clerkContext))),
  ),
  Layer.provideMerge(DesktopPreReadyPlatform.layer),
);

DesktopApp.program.pipe(Effect.provide(desktopRuntimeLayer), NodeRuntime.runMain);
