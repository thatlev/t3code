import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import {
  ProviderSessionReaper,
  type ProviderSessionReaperShape,
} from "../Services/ProviderSessionReaper.ts";
import { ProviderService } from "../Services/ProviderService.ts";

/**
 * An idle provider session keeps a CLI process, SDK stream, and MCP
 * connections resident. Hibernating it is safe once its resume cursor is
 * durable, but restarting can still add noticeable latency to the next turn,
 * so inactivity must be measured from the latest projected session activity
 * rather than only from the directory binding's original heartbeat.
 */
const DEFAULT_INACTIVITY_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Settling a thread is the user saying "I am done with this one for now", so
 * an explicitly settled session hibernates almost immediately instead of
 * waiting out the general threshold. The short grace still absorbs the case
 * where a thread is settled and then immediately reopened.
 */
const DEFAULT_SETTLED_INACTIVITY_THRESHOLD_MS = 60 * 1000;

const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;

export interface ProviderSessionReaperLiveOptions {
  readonly inactivityThresholdMs?: number;
  readonly settledInactivityThresholdMs?: number;
  readonly sweepIntervalMs?: number;
}

const makeProviderSessionReaper = (options?: ProviderSessionReaperLiveOptions) =>
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const directory = yield* ProviderSessionDirectory;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

    const inactivityThresholdMs = Math.max(
      1,
      options?.inactivityThresholdMs ?? DEFAULT_INACTIVITY_THRESHOLD_MS,
    );
    const settledInactivityThresholdMs = Math.max(
      1,
      options?.settledInactivityThresholdMs ?? DEFAULT_SETTLED_INACTIVITY_THRESHOLD_MS,
    );
    const sweepIntervalMs = Math.max(1, options?.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);
    // Cheap pre-filter so an obviously-fresh binding never costs a projection
    // read; the binding's own threshold is applied once we know the thread.
    const minimumThresholdMs = Math.min(inactivityThresholdMs, settledInactivityThresholdMs);

    const sweep = Effect.gen(function* () {
      const bindings = yield* directory.listBindings();
      const now = yield* Clock.currentTimeMillis;
      let reapedCount = 0;

      for (const binding of bindings) {
        if (binding.status === "stopped") {
          continue;
        }

        const lastSeenMs = Date.parse(binding.lastSeenAt);
        if (Number.isNaN(lastSeenMs)) {
          yield* Effect.logWarning("provider.session.reaper.invalid-last-seen", {
            threadId: binding.threadId,
            provider: binding.provider,
            lastSeenAt: binding.lastSeenAt,
          });
          continue;
        }

        const bindingIdleDurationMs = now - lastSeenMs;
        if (bindingIdleDurationMs < minimumThresholdMs) {
          continue;
        }

        const thread = yield* projectionSnapshotQuery
          .getThreadShellById(binding.threadId)
          .pipe(Effect.map(Option.getOrUndefined));
        if (thread?.session?.activeTurnId != null) {
          yield* Effect.logDebug("provider.session.reaper.skipped-active-turn", {
            threadId: binding.threadId,
            activeTurnId: thread.session.activeTurnId,
            idleDurationMs: bindingIdleDurationMs,
          });
          continue;
        }

        const projectedSessionUpdatedAtMs = thread?.session?.updatedAt
          ? Date.parse(thread.session.updatedAt)
          : Number.NaN;
        const latestActivityMs = Number.isNaN(projectedSessionUpdatedAtMs)
          ? lastSeenMs
          : Math.max(lastSeenMs, projectedSessionUpdatedAtMs);
        const idleDurationMs = now - latestActivityMs;
        const isSettled = thread?.settledOverride === "settled";
        const thresholdMs = isSettled ? settledInactivityThresholdMs : inactivityThresholdMs;
        if (idleDurationMs < thresholdMs) {
          continue;
        }

        const reaped = yield* providerService.stopSession({ threadId: binding.threadId }).pipe(
          Effect.tap(() =>
            Effect.logInfo("provider.session.reaped", {
              threadId: binding.threadId,
              provider: binding.provider,
              idleDurationMs,
              reason: isSettled ? "settled_thread" : "inactivity_threshold",
            }),
          ),
          Effect.as(true),
          Effect.catchCause((cause) =>
            Effect.logWarning("provider.session.reaper.stop-failed", {
              threadId: binding.threadId,
              provider: binding.provider,
              idleDurationMs,
              cause,
            }).pipe(Effect.as(false)),
          ),
        );

        if (reaped) {
          reapedCount += 1;
        }
      }

      if (reapedCount > 0) {
        yield* Effect.logInfo("provider.session.reaper.sweep-complete", {
          reapedCount,
          totalBindings: bindings.length,
        });
      }
    });

    const start: ProviderSessionReaperShape["start"] = () =>
      Effect.gen(function* () {
        yield* Effect.forkScoped(
          sweep.pipe(
            Effect.catch((error: unknown) =>
              Effect.logWarning("provider.session.reaper.sweep-failed", {
                error,
              }),
            ),
            Effect.catchDefect((defect: unknown) =>
              Effect.logWarning("provider.session.reaper.sweep-defect", {
                defect,
              }),
            ),
            Effect.repeat(Schedule.spaced(Duration.millis(sweepIntervalMs))),
          ),
        );

        yield* Effect.logInfo("provider.session.reaper.started", {
          inactivityThresholdMs,
          settledInactivityThresholdMs,
          sweepIntervalMs,
        });
      });

    return {
      start,
    } satisfies ProviderSessionReaperShape;
  });

export const makeProviderSessionReaperLive = (options?: ProviderSessionReaperLiveOptions) =>
  Layer.effect(ProviderSessionReaper, makeProviderSessionReaper(options));

export const ProviderSessionReaperLive = makeProviderSessionReaperLive();
