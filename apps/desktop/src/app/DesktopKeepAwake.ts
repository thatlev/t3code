// @effect-diagnostics nodeBuiltinImport:off -- caffeinate is a macOS process boundary.
import { spawn, type ChildProcess } from "node:child_process";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";

export class DesktopKeepAwake extends Context.Service<
  DesktopKeepAwake,
  {
    readonly reconcile: (enabled: boolean) => Effect.Effect<boolean>;
    readonly stop: Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopKeepAwake") {}

export interface KeepAwakeProcess {
  readonly pid?: number | undefined;
  readonly killed: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "exit" | "error", listener: () => void): unknown;
}

export const makeController = (
  platform: NodeJS.Platform,
  spawnProcess: () => KeepAwakeProcess = () =>
    spawn("/usr/bin/caffeinate", ["-i"], {
      stdio: "ignore",
      windowsHide: true,
    }) as ChildProcess as KeepAwakeProcess,
) =>
  Effect.gen(function* () {
    const mutex = yield* Semaphore.make(1);
    let active: KeepAwakeProcess | null = null;

    const stop = mutex.withPermits(1)(
      Effect.sync(() => {
        const process = active;
        active = null;
        if (process && !process.killed) process.kill("SIGTERM");
      }),
    );

    const reconcile = (enabled: boolean) =>
      mutex.withPermits(1)(
        Effect.sync(() => {
          if (platform !== "darwin") return false;
          if (!enabled) {
            const process = active;
            active = null;
            if (process && !process.killed) process.kill("SIGTERM");
            return false;
          }
          if (active !== null && !active.killed) return true;
          const process = spawnProcess();
          active = process;
          const clear = () => {
            if (active === process) active = null;
          };
          process.once("exit", clear);
          process.once("error", clear);
          return true;
        }),
      );

    return DesktopKeepAwake.of({ reconcile, stop });
  });

export const layer = Layer.effect(
  DesktopKeepAwake,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const controller = yield* makeController(environment.platform);
    yield* Effect.addFinalizer(() => controller.stop);
    return controller;
  }),
);
