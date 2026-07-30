import { ProviderDriverKind, type ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { describe, expect, it } from "vite-plus/test";

import { cycleProviderReasoningEffort } from "./composerEffortCycle";

const CODEX = ProviderDriverKind.make("codex");
const CLAUDE = ProviderDriverKind.make("claudeAgent");

function model(slug: string, descriptors: ReadonlyArray<unknown>): ServerProviderModel {
  return {
    slug,
    name: slug,
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: descriptors as never,
    }),
  } as ServerProviderModel;
}

const codexModels = [
  model("gpt-5.3-codex", [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium", isDefault: true },
        { id: "high", label: "High" },
      ],
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "standard", label: "Standard", isDefault: true },
        { id: "priority", label: "Priority" },
      ],
      currentValue: "standard",
    },
  ]),
];

// Claude names the same control `effort`, which is exactly what the old
// hard-coded `reasoningEffort` writer got wrong.
const claudeModels = [
  model("claude-opus-5", [
    {
      id: "effort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High", isDefault: true },
        { id: "ultrathink", label: "Ultrathink" },
      ],
      promptInjectedValues: ["ultrathink"],
    },
    { id: "fastMode", label: "Fast Mode", type: "boolean" },
  ]),
];

describe("cycleProviderReasoningEffort", () => {
  it("steps the Codex reasoning descriptor up from its default", () => {
    const result = cycleProviderReasoningEffort({
      provider: CODEX,
      model: "gpt-5.3-codex",
      models: codexModels,
      modelOptions: undefined,
      direction: 1,
    });
    expect(result?.descriptorId).toBe("reasoningEffort");
    expect(result?.value).toBe("high");
    expect(result?.options).toContainEqual({ id: "reasoningEffort", value: "high" });
  });

  it("preserves other descriptor selections while stepping", () => {
    const result = cycleProviderReasoningEffort({
      provider: CODEX,
      model: "gpt-5.3-codex",
      models: codexModels,
      modelOptions: [{ id: "serviceTier", value: "priority" }],
      direction: -1,
    });
    expect(result?.value).toBe("low");
    expect(result?.options).toContainEqual({ id: "serviceTier", value: "priority" });
  });

  it("steps Claude's `effort` descriptor, not a hard-coded id", () => {
    const result = cycleProviderReasoningEffort({
      provider: CLAUDE,
      model: "claude-opus-5",
      models: claudeModels,
      modelOptions: [{ id: "effort", value: "low" }],
      direction: 1,
    });
    expect(result?.descriptorId).toBe("effort");
    expect(result?.value).toBe("medium");
  });

  it("skips prompt-injected choices and clamps at the ends", () => {
    const result = cycleProviderReasoningEffort({
      provider: CLAUDE,
      model: "claude-opus-5",
      models: claudeModels,
      modelOptions: [{ id: "effort", value: "high" }],
      direction: 1,
    });
    expect(result?.value).toBe("high");
  });

  it("returns null when the model declares no select option", () => {
    expect(
      cycleProviderReasoningEffort({
        provider: CLAUDE,
        model: "claude-haiku",
        models: [model("claude-haiku", [])],
        modelOptions: undefined,
        direction: 1,
      }),
    ).toBeNull();
  });
});
