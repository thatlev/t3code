import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  isProviderUsageLimitFailure,
  presentEmptyAcpTurnFailure,
  presentProviderFailure,
} from "./ProviderErrorPresentation.ts";

describe("ProviderErrorPresentation", () => {
  it.each([
    "usage limit reached",
    "rate_limit_exceeded",
    "Quota exhausted",
    "insufficient credits",
    "Too many requests",
    "RESOURCE_EXHAUSTED",
    "Request failed with HTTP 429",
  ])("recognizes usage exhaustion: %s", (detail) => {
    expect(isProviderUsageLimitFailure(detail)).toBe(true);
  });

  it("does not relabel unrelated provider failures", () => {
    const detail = "Authentication failed. Please sign in.";
    expect(presentProviderFailure(ProviderDriverKind.make("claudeAgent"), detail)).toBe(detail);
  });

  it("presents provider-named usage errors consistently", () => {
    expect(
      presentProviderFailure(ProviderDriverKind.make("kimi"), "HTTP 429: quota exhausted"),
    ).toBe(
      "Kimi usage limit reached. Check your Kimi plan or wait for the limit to reset, then try again.",
    );
    expect(
      presentProviderFailure(ProviderDriverKind.make("codex"), "rate_limit_exceeded"),
    ).toContain("Codex usage limit reached.");
  });

  it("maps Kimi's empty successful ACP turn to its known quota failure", () => {
    expect(presentEmptyAcpTurnFailure(ProviderDriverKind.make("kimi"))).toContain(
      "Kimi usage limit reached.",
    );
    expect(presentEmptyAcpTurnFailure(ProviderDriverKind.make("cursor"))).not.toContain(
      "usage limit reached",
    );
  });
});
