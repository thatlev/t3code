/**
 * Optional integration check against a real `kimi acp` install.
 * Enable with: T3_KIMI_ACP_PROBE=1 pnpm --filter t3 exec vp test run src/provider/acp/KimiAcpCliProbe.test.ts
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import { CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES } from "../Layers/CursorProvider.ts";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

describe.runIf(process.env.T3_KIMI_ACP_PROBE === "1")("Kimi ACP CLI probe", () => {
  it.effect("starts a real session and accepts K3 with an advertised effort", () =>
    Effect.gen(function* () {
      const runtime = yield* AcpSessionRuntime.AcpSessionRuntime;
      const started = yield* runtime.start();

      expect(started.initializeResult).toBeDefined();
      expect(started.sessionId.length).toBeGreaterThan(0);

      yield* runtime.setModel("kimi-code/k3");
      const effort = (yield* runtime.getConfigOptions).find((option) => {
        const search = `${option.id} ${option.name} ${option.category ?? ""}`.toLowerCase();
        return option.type === "select" && /(effort|reason|thought)/.test(search);
      });
      expect(effort).toBeDefined();

      if (effort?.type === "select") {
        const values = effort.options.flatMap((entry) =>
          "value" in entry ? [entry.value] : entry.options.map((option) => option.value),
        );
        const supportedValues = new Set(values);
        const supported = ["low", "high", "max"].filter((value) => supportedValues.has(value));
        expect(supported.length).toBeGreaterThan(0);
        yield* runtime.setConfigOption(
          effort.id,
          supported.includes("high") ? "high" : supported[0]!,
        );
      }
    }).pipe(
      Effect.provide(
        AcpSessionRuntime.layer({
          spawn: {
            command: "kimi",
            args: ["acp"],
            cwd: process.cwd(),
            forceKillAfter: "2 seconds",
          },
          cwd: process.cwd(),
          clientCapabilities: CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES,
          clientInfo: { name: "t3-kimi-probe", version: "0.0.0" },
          authMethodId: "login",
        }),
      ),
      Effect.scoped,
      Effect.provide(NodeServices.layer),
    ),
  );
});
