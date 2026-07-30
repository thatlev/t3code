import {
  type KimiSettings,
  type ModelCapabilities,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createModelCapabilities } from "@t3tools/shared/model";
import { causeErrorTag } from "@t3tools/shared/observability";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import { HttpClient } from "effect/unstable/http";

import { makeKimiAcpRuntime } from "../acp/KimiAcpSupport.ts";
import {
  buildSelectOptionDescriptor,
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";

const KIMI_PRESENTATION = {
  displayName: "Kimi",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: false,
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });
const VERSION_PROBE_TIMEOUT_MS = 4_000;
const ACP_PROBE_TIMEOUT_MS = 15_000;
const FALLBACK_MODELS: ReadonlyArray<ServerProviderModel> = [
  { slug: "default", name: "Kimi default", isCustom: false, capabilities: EMPTY_CAPABILITIES },
];

function modelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
  discovered: ReadonlyArray<ServerProviderModel> = FALLBACK_MODELS,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(discovered, customModels ?? [], EMPTY_CAPABILITIES);
}

function modelsFromAcp(
  state: EffectAcpSchema.SessionModelState | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  if (!state) return [];
  const seen = new Set<string>();
  return state.availableModels.flatMap((model) => {
    const slug = model.modelId.trim();
    if (!slug || seen.has(slug)) return [];
    seen.add(slug);
    return [
      {
        slug,
        name: model.name.trim() || slug,
        isCustom: false,
        capabilities: EMPTY_CAPABILITIES,
      },
    ];
  });
}

type KimiProviderCatalog = {
  readonly defaultModel?: unknown;
  readonly models?: unknown;
};

const KIMI_DEFAULT_MODEL_PREFERENCE = [
  "kimi-code/kimi-for-coding-highspeed",
  "kimi-code/k3",
  "kimi-code/kimi-for-coding",
] as const;

export function modelsFromKimiProviderCatalog(raw: string): ReadonlyArray<ServerProviderModel> {
  let catalog: KimiProviderCatalog;
  try {
    catalog = JSON.parse(raw) as KimiProviderCatalog;
  } catch {
    return [];
  }
  if (!catalog.models || typeof catalog.models !== "object" || Array.isArray(catalog.models)) {
    return [];
  }

  const configuredDefaultModel =
    typeof catalog.defaultModel === "string" ? catalog.defaultModel.trim() : undefined;
  const modelIds = new Set(Object.keys(catalog.models as Record<string, unknown>));
  const defaultModel =
    configuredDefaultModel && modelIds.has(configuredDefaultModel)
      ? configuredDefaultModel
      : KIMI_DEFAULT_MODEL_PREFERENCE.find((model) => modelIds.has(model));
  return Object.entries(catalog.models as Record<string, unknown>).flatMap(
    ([rawSlug, rawModel]) => {
      const slug = rawSlug.trim();
      if (!slug || !rawModel || typeof rawModel !== "object" || Array.isArray(rawModel)) return [];
      const model = rawModel as Record<string, unknown>;
      const name =
        typeof model.displayName === "string" && model.displayName.trim()
          ? model.displayName.trim()
          : slug;
      const efforts = Array.isArray(model.supportEfforts)
        ? model.supportEfforts.filter(
            (effort): effort is string => typeof effort === "string" && effort.trim().length > 0,
          )
        : [];
      const defaultEffort =
        typeof model.defaultEffort === "string" ? model.defaultEffort.trim() : undefined;
      const capabilities =
        efforts.length > 0
          ? createModelCapabilities({
              optionDescriptors: [
                buildSelectOptionDescriptor({
                  id: "reasoning",
                  label: "Reasoning effort",
                  options: efforts.map((effort) => ({
                    value: effort,
                    label: effort.charAt(0).toUpperCase() + effort.slice(1),
                    ...(effort === defaultEffort ? { isDefault: true } : {}),
                  })),
                }),
              ],
            })
          : EMPTY_CAPABILITIES;
      return [
        {
          slug,
          name,
          isCustom: false,
          ...(slug === defaultModel ? { isDefault: true } : {}),
          capabilities,
        } satisfies ServerProviderModel,
      ];
    },
  );
}

const discoverModelsFromProviderCatalog = (
  settings: KimiSettings,
  environment: NodeJS.ProcessEnv,
) =>
  Effect.gen(function* () {
    const command = settings.binaryPath || "kimi";
    const spawnCommand = yield* resolveSpawnCommand(command, ["provider", "list", "--json"], {
      env: environment,
    });
    const result = yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
    return result.code === 0 ? modelsFromKimiProviderCatalog(result.stdout) : [];
  });

export function buildInitialKimiProviderSnapshot(
  settings: KimiSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.map(DateTime.now, (now) =>
    buildServerProvider({
      presentation: KIMI_PRESENTATION,
      enabled: settings.enabled,
      checkedAt: DateTime.formatIso(now),
      models: modelsFromSettings(settings.customModels),
      probe: settings.enabled
        ? {
            installed: true,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Checking Kimi Code CLI availability…",
          }
        : {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Kimi is disabled in T3 Code settings.",
          },
    }),
  );
}

const discoverModels = (settings: KimiSettings, environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const runtime = yield* makeKimiAcpRuntime({
      cursorSettings: settings,
      environment,
      childProcessSpawner,
      cwd: process.cwd(),
      clientInfo: { name: "t3-code-provider-probe", version: "0.0.0" },
    });
    const started = yield* runtime.start();
    return modelsFromAcp(started.sessionSetupResult.models);
  }).pipe(Effect.scoped);

const runVersion = (settings: KimiSettings, environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const command = settings.binaryPath || "kimi";
    const spawnCommand = yield* resolveSpawnCommand(command, ["--version"], { env: environment });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
  });

export const checkKimiProviderStatus = Effect.fn("checkKimiProviderStatus")(function* (
  settings: KimiSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = modelsFromSettings(settings.customModels);
  if (!settings.enabled) {
    return buildServerProvider({
      presentation: KIMI_PRESENTATION,
      enabled: false,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Kimi is disabled in T3 Code settings.",
      },
    });
  }

  const versionResult = yield* runVersion(settings, environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(versionResult)) {
    return buildServerProvider({
      presentation: KIMI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(versionResult.failure),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(versionResult.failure)
          ? "Kimi Code CLI (`kimi`) is not installed or not on PATH."
          : "Failed to execute the Kimi Code CLI.",
      },
    });
  }
  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: KIMI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Kimi Code CLI timed out while checking its version.",
      },
    });
  }

  const versionOutput = versionResult.success.value;
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  const catalogProbe = yield* discoverModelsFromProviderCatalog(settings, environment).pipe(
    Effect.timeoutOption(ACP_PROBE_TIMEOUT_MS),
    Effect.result,
  );
  const catalogModels =
    Result.isSuccess(catalogProbe) && Option.isSome(catalogProbe.success)
      ? catalogProbe.success.value
      : [];
  const probe = yield* (
    catalogModels.length > 0 ? Effect.succeed(catalogModels) : discoverModels(settings, environment)
  ).pipe(Effect.timeoutOption(ACP_PROBE_TIMEOUT_MS), Effect.result);
  if (Result.isFailure(probe) || Option.isNone(probe.success)) {
    return buildServerProvider({
      presentation: KIMI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "warning",
        auth: { status: "unauthenticated" },
        message: "Kimi is installed but ACP setup needs attention. Run `kimi login`, then refresh.",
      },
    });
  }

  const discovered = probe.success.value;
  return buildServerProvider({
    presentation: KIMI_PRESENTATION,
    enabled: true,
    checkedAt,
    models: modelsFromSettings(
      settings.customModels,
      discovered.length > 0 ? discovered : FALLBACK_MODELS,
    ),
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "authenticated" },
      message: "Kimi Code CLI is ready through ACP.",
    },
  });
});

export const enrichKimiSnapshot = (input: {
  readonly snapshot: ServerProvider;
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly enableProviderUpdateChecks?: boolean;
  readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  readonly httpClient: HttpClient.HttpClient;
}): Effect.Effect<void> =>
  enrichProviderSnapshotWithVersionAdvisory(input.snapshot, input.maintenanceCapabilities, {
    enableProviderUpdateChecks: input.enableProviderUpdateChecks,
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, input.httpClient),
    Effect.flatMap(input.publishSnapshot),
    Effect.catchCause((cause) =>
      Effect.logWarning("Kimi version advisory enrichment failed", {
        errorTag: causeErrorTag(cause),
      }),
    ),
    Effect.asVoid,
  );
