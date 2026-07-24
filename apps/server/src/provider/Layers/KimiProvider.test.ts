import { describe, expect, it } from "vite-plus/test";

import { modelsFromKimiProviderCatalog } from "./KimiProvider.ts";

describe("modelsFromKimiProviderCatalog", () => {
  it("exposes every configured model and each model's supported efforts", () => {
    const models = modelsFromKimiProviderCatalog(
      JSON.stringify({
        defaultModel: "kimi-code/k3",
        models: {
          "kimi-code/kimi-for-coding": { displayName: "K2.7 Coding" },
          "kimi-code/kimi-for-coding-highspeed": {
            displayName: "K2.7 Coding Highspeed",
          },
          "kimi-code/k3": {
            displayName: "K3",
            supportEfforts: ["low", "high", "max"],
            defaultEffort: "high",
          },
        },
      }),
    );

    expect(models.map((model) => model.slug)).toEqual([
      "kimi-code/kimi-for-coding",
      "kimi-code/kimi-for-coding-highspeed",
      "kimi-code/k3",
    ]);
    expect(models[2]).toMatchObject({
      isDefault: true,
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoning",
            currentValue: "high",
            options: [
              { id: "low", label: "Low" },
              { id: "high", label: "High", isDefault: true },
              { id: "max", label: "Max" },
            ],
          },
        ],
      },
    });
  });

  it("returns no models for malformed output", () => {
    expect(modelsFromKimiProviderCatalog("not json")).toEqual([]);
  });
});
