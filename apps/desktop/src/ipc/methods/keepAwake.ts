import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopKeepAwake from "../../app/DesktopKeepAwake.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getKeepMacAwake = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_KEEP_MAC_AWAKE_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.keepAwake.get")(function* () {
    const settings = yield* DesktopAppSettings.DesktopAppSettings;
    return (yield* settings.get).keepMacAwake;
  }),
});

export const setKeepMacAwake = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_KEEP_MAC_AWAKE_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.keepAwake.set")(function* (enabled) {
    const settings = yield* DesktopAppSettings.DesktopAppSettings;
    const keepAwake = yield* DesktopKeepAwake.DesktopKeepAwake;
    const change = yield* settings.setKeepMacAwake(enabled);
    yield* keepAwake.reconcile(change.settings.keepMacAwake);
    return change.settings.keepMacAwake;
  }),
});
