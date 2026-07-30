import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import { afterIpcReply } from "./serverExposure.ts";

it.effect("delays relaunch until after the IPC reply can be delivered", () =>
  Effect.gen(function* () {
    const reasons: string[] = [];
    const fiber = yield* afterIpcReply(
      Effect.sync(() => {
        reasons.push("network-mode-changed");
      }),
    ).pipe(Effect.forkChild);

    yield* Effect.yieldNow;
    assert.deepStrictEqual(reasons, []);

    yield* TestClock.adjust("249 millis");
    assert.deepStrictEqual(reasons, []);

    yield* TestClock.adjust("1 millis");
    yield* Fiber.join(fiber);
    assert.deepStrictEqual(reasons, ["network-mode-changed"]);
  }).pipe(Effect.provide(TestClock.layer())),
);
