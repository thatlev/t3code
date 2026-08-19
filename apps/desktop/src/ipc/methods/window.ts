import {
  ContextMenuItemSchema,
  DesktopAppBrandingSchema,
  DesktopEnvironmentBootstrapSchema,
  DesktopThemeSchema,
  EDITORS,
  EditorId,
  PickedThemeFileSchema,
  PickFolderOptionsSchema,
  PRIMARY_LOCAL_ENVIRONMENT_ID,
  REMOTE_CAPABLE_EDITOR_IDS,
  type DesktopEnvironmentBootstrap,
  type PickedThemeFile,
} from "@t3tools/contracts";
import { isCommandAvailable } from "@t3tools/shared/shell";
import * as NodeOS from "node:os";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopBackendPool from "../../backend/DesktopBackendPool.ts";
import * as DesktopLocalEnvironmentAuth from "../../backend/DesktopLocalEnvironmentAuth.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import * as DesktopWslBackend from "../../wsl/DesktopWslBackend.ts";
import * as DesktopWslEnvironment from "../../wsl/DesktopWslEnvironment.ts";
import * as DesktopThreadWindows from "../../window/DesktopThreadWindows.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronMenu from "../../electron/ElectronMenu.ts";
import * as ElectronProtocol from "../../electron/ElectronProtocol.ts";
import * as ElectronShell from "../../electron/ElectronShell.ts";
import * as ElectronTheme from "../../electron/ElectronTheme.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import {
  extractDistroFromUncPath,
  resolveWslPickFolderDefaultPath,
  wslUncPathToLinuxPath,
} from "../../wsl/wslPathParsing.ts";

const ContextMenuPosition = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
});

const ContextMenuInput = Schema.Struct({
  items: Schema.Array(ContextMenuItemSchema),
  position: Schema.optionalKey(ContextMenuPosition),
});

const OpenThreadWindowInput = Schema.Struct({
  environmentId: Schema.String.check(Schema.isNonEmpty()),
  threadId: Schema.String.check(Schema.isNonEmpty()),
  // Screen coordinates of the point the chat was dropped at, null when the
  // window is opened without a drag (menu, keyboard).
  anchor: Schema.NullOr(
    Schema.Struct({
      x: Schema.Finite,
      y: Schema.Finite,
    }),
  ),
  // Size of the window the chat was torn off, so the new one matches it.
  size: Schema.NullOr(
    Schema.Struct({
      width: Schema.Finite,
      height: Schema.Finite,
    }),
  ),
});

function toWebSocketBaseUrl(httpBaseUrl: URL): string {
  const url = new URL(httpBaseUrl.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

export const getAppBranding = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_APP_BRANDING_CHANNEL,
  result: Schema.NullOr(DesktopAppBrandingSchema),
  handler: Effect.fn("desktop.ipc.window.getAppBranding")(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    return environment.branding;
  }),
});

export const getSystemLocale = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_SYSTEM_LOCALE_CHANNEL,
  result: Schema.String,
  handler: Effect.fn("desktop.ipc.window.getSystemLocale")(function* () {
    const electronApp = yield* ElectronApp.ElectronApp;
    return yield* electronApp.systemLocale;
  }),
});

export const getWindowFullscreenState = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_WINDOW_FULLSCREEN_STATE_CHANNEL,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.window.getWindowFullscreenState")(function* () {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.currentMainOrFirst;
    return Option.isSome(window) && window.value.isFullScreen();
  }),
});

export const getLocalEnvironmentBootstraps = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_LOCAL_ENVIRONMENT_BOOTSTRAPS_CHANNEL,
  result: Schema.Array(DesktopEnvironmentBootstrapSchema),
  handler: Effect.fn("desktop.ipc.window.getLocalEnvironmentBootstraps")(function* () {
    const pool = yield* DesktopBackendPool.DesktopBackendPool;
    const instances = yield* pool.list;
    const bootstraps: DesktopEnvironmentBootstrap[] = [];
    for (const instance of instances) {
      const isPrimary = instance.id === PRIMARY_LOCAL_ENVIRONMENT_ID;
      const config = yield* instance.currentConfig;
      const snapshot = yield* instance.snapshot;
      // A secondary backend (e.g. a parallel WSL backend) that hasn't produced
      // a config yet (mid-registration, before its first start cycle) or that
      // is retrying a *transient* preflight failure (WSL VM still booting, a
      // not-yet-built linux server entry) is not listening on a port. We
      // surface it as a *pending* bootstrap (null endpoints, no token) so the
      // renderer can show a "Connecting…" indicator while it retries — null
      // endpoints keep the renderer from dialing the dead port, avoiding the
      // needless /api/auth/bootstrap/bearer error cycles a real endpoint would
      // trigger.
      if (Option.isNone(config) || Option.isSome(config.value.preflightFailure)) {
        // Skip the primary (same-origin, no "connecting" affordance) and skip a
        // secondary whose preflight failed *fatally* (no node, wrong version,
        // missing build tools): it has stopped retrying, so an indefinite
        // "Connecting…" would be misleading — its error is surfaced by the
        // WSL-state UI instead.
        const fatalPreflight =
          Option.isSome(config) &&
          Option.isSome(config.value.preflightFailure) &&
          config.value.preflightFailure.value.fatal;
        const stoppedPreflight =
          Option.isSome(config) &&
          Option.isSome(config.value.preflightFailure) &&
          (!snapshot.desiredRunning || !snapshot.restartScheduled);
        if (isPrimary || fatalPreflight || stoppedPreflight) continue;
        bootstraps.push({
          id: instance.id,
          label: yield* instance.label,
          runningDistro: null,
          httpBaseUrl: null,
          wsBaseUrl: null,
        });
        continue;
      }
      const { bootstrap, httpBaseUrl } = config.value;
      const runningDistro = config.value.runningDistro ?? null;
      bootstraps.push({
        id: instance.id,
        label: runningDistro === null ? yield* instance.label : `WSL (${runningDistro})`,
        runningDistro,
        httpBaseUrl: httpBaseUrl.href,
        wsBaseUrl: toWebSocketBaseUrl(httpBaseUrl),
        ...(bootstrap.desktopBootstrapToken
          ? { bootstrapToken: bootstrap.desktopBootstrapToken }
          : {}),
      });
    }
    return bootstraps;
  }),
});

// Pull the distro selection out of a backend instance id like
// "wsl:ubuntu". Returns null for "wsl:default", which is the sentinel
// for "track the user's WSL default distro" and maps to the
// wslEnv-derived default at picker time.
function extractWslDistroFromEnvironmentId(envId: string): string | null {
  if (!envId.startsWith(DesktopWslBackend.WSL_INSTANCE_ID_PREFIX)) {
    return null;
  }
  const suffix = envId.slice(DesktopWslBackend.WSL_INSTANCE_ID_PREFIX.length);
  return suffix === "default" || suffix.length === 0 ? null : suffix;
}

export const getLocalEnvironmentBearerToken = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_LOCAL_ENVIRONMENT_BEARER_TOKEN_CHANNEL,
  payload: Schema.Void,
  result: Schema.String,
  handler: Effect.fn("desktop.ipc.window.getLocalEnvironmentBearerToken")(function* () {
    const localAuth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
    return yield* localAuth.getBearerToken;
  }),
});

export const pickFolder = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PICK_FOLDER_CHANNEL,
  payload: Schema.UndefinedOr(PickFolderOptionsSchema),
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.window.pickFolder")(function* (options) {
    const dialog = yield* ElectronDialog.ElectronDialog;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    const wslEnvironment = yield* DesktopWslEnvironment.DesktopWslEnvironment;
    // Three picker modes:
    //   - targetEnvironmentId omitted: default to the primary picker. Keeps
    //     the historical behavior unchanged for users who never enabled the
    //     WSL backend, and is what unfamiliar callers should get out of the
    //     box.
    //   - targetEnvironmentId starts with "wsl:": route to the WSL picker
    //     using the distro encoded in the id (or the user's selected
    //     wslDistro when the id is the "wsl:default" sentinel).
    //   - anything else (incl. PRIMARY_LOCAL_ENVIRONMENT_ID): primary picker.
    const targetId = options?.targetEnvironmentId;
    const wslDistroFromTarget =
      targetId !== undefined && targetId.startsWith(DesktopWslBackend.WSL_INSTANCE_ID_PREFIX)
        ? extractWslDistroFromEnvironmentId(targetId)
        : null;
    const useWsl =
      targetId !== undefined &&
      targetId !== PRIMARY_LOCAL_ENVIRONMENT_ID &&
      targetId.startsWith(DesktopWslBackend.WSL_INSTANCE_ID_PREFIX);
    const settings = yield* appSettings.get;
    // Fall back to the persisted wslDistro when the id is the
    // "wsl:default" sentinel; the orchestrator uses the same fallback
    // for the actual backend.
    const wslDistro = useWsl ? (wslDistroFromTarget ?? settings.wslDistro) : null;
    const defaultPath = useWsl
      ? Option.fromNullishOr(
          resolveWslPickFolderDefaultPath(
            options,
            { distro: wslDistro },
            yield* wslEnvironment.listDistros,
            Option.getOrNull(yield* wslEnvironment.getUserHome(wslDistro)),
          ),
        )
      : environment.resolvePickFolderDefaultPath(options);
    const selectedPath = yield* dialog.pickFolder({
      owner: yield* electronWindow.focusedMainOrFirst,
      defaultPath,
    });
    if (Option.isNone(selectedPath)) {
      return null;
    }
    if (!useWsl) {
      return selectedPath.value;
    }

    const linuxUncPath = wslUncPathToLinuxPath(selectedPath.value);
    if (linuxUncPath !== null) {
      return linuxUncPath;
    }

    const converted = yield* wslEnvironment.windowsToWslPath(
      extractDistroFromUncPath(selectedPath.value) ?? wslDistro,
      selectedPath.value,
    );
    return Option.getOrElse(converted, () => selectedPath.value);
  }),
});

export const setTheme = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_THEME_CHANNEL,
  payload: DesktopThemeSchema,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.window.setTheme")(function* (theme) {
    const electronTheme = yield* ElectronTheme.ElectronTheme;
    yield* electronTheme.setSource(theme);
    return yield* electronTheme.shouldUseDarkColors;
  }),
});

export const showContextMenu = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CONTEXT_MENU_CHANNEL,
  payload: ContextMenuInput,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.window.showContextMenu")(function* (input) {
    const electronMenu = yield* ElectronMenu.ElectronMenu;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.focusedMainOrFirst;
    if (Option.isNone(window)) {
      return null;
    }

    const selectedItemId = yield* electronMenu.showContextMenu({
      window: window.value,
      items: input.items,
      position: Option.fromNullishOr(input.position),
    });
    return Option.getOrNull(selectedItemId);
  }),
});

/**
 * Tears a chat off into its own app window, the way a browser tab detaches.
 * The renderer decides *when* (a drag released outside every window); placement
 * and window lifecycle stay here.
 */
export const openThreadWindow = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.OPEN_THREAD_WINDOW_CHANNEL,
  payload: OpenThreadWindowInput,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.window.openThreadWindow")(function* (input) {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.openDetachedWindow({
      routeHash: ElectronProtocol.getThreadRouteHash(input),
      threadKey: DesktopThreadWindows.desktopThreadKey(input),
      anchor: input.anchor,
      size: input.size,
    });
  }),
});

/**
 * Records that the calling window is now showing a chat, moving it out of
 * whichever window held it before. This is what keeps a chat in exactly one
 * window as the user navigates, and what returns a torn-off chat to the main
 * window when it is reopened there.
 */
/**
 * Raises the window holding a chat and points it there, instead of pulling the
 * chat into the caller. Returns false when no other window holds it, which
 * means the caller should just navigate itself.
 */
export const focusThreadWindow = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FOCUS_THREAD_WINDOW_CHANNEL,
  payload: Schema.String.check(Schema.isNonEmpty()),
  result: Schema.Boolean,
  handler: (threadKey, caller) =>
    Effect.sync(() =>
      caller.webContentsId === null
        ? false
        : DesktopThreadWindows.desktopThreadWindows.focusThread({
            threadKey,
            requesterWebContentsId: caller.webContentsId,
          }),
    ).pipe(Effect.withSpan("desktop.ipc.window.focusThreadWindow")),
});

export const claimThreadWindow = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CLAIM_THREAD_WINDOW_CHANNEL,
  payload: Schema.String.check(Schema.isNonEmpty()),
  result: Schema.Void,
  handler: (threadKey, caller) =>
    Effect.sync(() => {
      if (caller.webContentsId === null) {
        return;
      }
      DesktopThreadWindows.desktopThreadWindows.claim({
        webContentsId: caller.webContentsId,
        threadKey,
      });
    }).pipe(Effect.withSpan("desktop.ipc.window.claimThreadWindow")),
});

export const openExternal = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.OPEN_EXTERNAL_CHANNEL,
  payload: Schema.String,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.window.openExternal")(function* (url) {
    const shell = yield* ElectronShell.ElectronShell;
    return yield* shell.openExternal(url);
  }),
});

export const probeRemoteEditors = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PROBE_REMOTE_EDITORS_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Array(EditorId),
  // Probes THIS machine (where the renderer runs) for remote-capable editor
  // CLIs, unlike the server's probe which walks the environment host's PATH.
  // A Finder-launched app can miss PATH entries; an empty result makes the
  // renderer fall back to VS Code only, so that fails soft.
  handler: Effect.fn("desktop.ipc.window.probeRemoteEditors")(function* () {
    const available: Array<EditorId> = [];
    for (const editorId of REMOTE_CAPABLE_EDITOR_IDS) {
      const commands = EDITORS.find((editor) => editor.id === editorId)?.commands;
      if (!commands) continue;
      for (const command of commands) {
        if (yield* isCommandAvailable(command, { env: process.env })) {
          available.push(editorId);
          break;
        }
      }
    }
    return available;
  }),
});

/** Theme files are a few KB; anything larger returns empty text and lets the
 *  renderer reject it by size without the contents ever crossing the bridge. */
const PICKED_THEME_FILE_MAX_BYTES = 256 * 1024;

export const pickThemeFiles = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PICK_THEME_FILES_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.NullOr(Schema.Array(PickedThemeFileSchema)),
  handler: Effect.fn("desktop.ipc.window.pickThemeFiles")(function* () {
    const dialog = yield* ElectronDialog.ElectronDialog;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // The VS Code extensions directory is the same dotfolder on Windows,
    // macOS, and Linux; when it is missing the picker opens wherever the
    // platform would by default.
    const extensionsDir = path.join(NodeOS.homedir(), ".vscode", "extensions");
    const defaultPath = yield* fileSystem
      .exists(extensionsDir)
      .pipe(Effect.orElseSucceed(() => false));
    const paths = yield* dialog.pickFiles({
      owner: yield* electronWindow.focusedMainOrFirst,
      defaultPath: defaultPath ? Option.some(extensionsDir) : Option.none(),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (paths.length === 0) {
      return null;
    }
    return yield* Effect.forEach(paths, (filePath) => {
      const name = path.basename(filePath);
      return Effect.gen(function* () {
        const info = yield* fileSystem.stat(filePath);
        const size = Number(info.size);
        if (size > PICKED_THEME_FILE_MAX_BYTES) {
          return { name, size, text: "" } satisfies PickedThemeFile;
        }
        const text = yield* fileSystem.readFileString(filePath);
        return { name, size, text } satisfies PickedThemeFile;
      }).pipe(
        // An unreadable file degrades to an entry the renderer reports.
        Effect.orElseSucceed((): PickedThemeFile => ({ name, size: 0, text: "" })),
      );
    });
  }),
});
