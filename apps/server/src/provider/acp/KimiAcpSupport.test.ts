import { describe, expect, it } from "@effect/vitest";

import { buildKimiAcpSpawnInput } from "./KimiAcpSupport.ts";

describe("buildKimiAcpSpawnInput", () => {
  it("builds the standard Kimi ACP command", () => {
    expect(buildKimiAcpSpawnInput(undefined, "/tmp/project")).toEqual({
      command: "kimi",
      args: ["acp"],
      cwd: "/tmp/project",
      forceKillAfter: "2 seconds",
    });
  });

  it("uses the configured binary and preserves the provider environment", () => {
    const environment = { KIMI_CONFIG_DIR: "/tmp/kimi-config" };
    expect(
      buildKimiAcpSpawnInput(
        { binaryPath: "/Applications/Kimi/bin/kimi" },
        "/tmp/project",
        environment,
      ),
    ).toEqual({
      command: "/Applications/Kimi/bin/kimi",
      args: ["acp"],
      cwd: "/tmp/project",
      forceKillAfter: "2 seconds",
      env: environment,
    });
  });
});
