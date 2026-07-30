import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopBackendPool from "../../backend/DesktopBackendPool.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getRemoteAccessEnabled = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_REMOTE_ACCESS_ENABLED_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.remoteAccess.get")(function* () {
    const settings = yield* DesktopAppSettings.DesktopAppSettings;
    return (yield* settings.get).remoteAccessEnabled;
  }),
});

export const setRemoteAccessEnabled = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_REMOTE_ACCESS_ENABLED_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.remoteAccess.set")(function* (enabled) {
    const settings = yield* DesktopAppSettings.DesktopAppSettings;
    const pool = yield* DesktopBackendPool.DesktopBackendPool;
    const change = yield* settings.setRemoteAccessEnabled(enabled);
    if (change.changed) {
      const primary = yield* pool.primary;
      yield* primary.stop();
      yield* primary.start;
    }
    return change.settings.remoteAccessEnabled;
  }),
});
