import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const insertThread = (input: { readonly threadId: string; readonly latestTurnId: string | null }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
    INSERT INTO projection_threads (
      thread_id, project_id, title, model_selection_json, runtime_mode,
      interaction_mode, branch, worktree_path, latest_turn_id, created_at,
      updated_at, archived_at, latest_user_message_at, pending_approval_count,
      pending_user_input_count, has_actionable_proposed_plan, deleted_at
    ) VALUES (
      ${input.threadId}, 'project-1', 'Thread',
      '{"provider":"codex","model":"gpt-5-codex"}', 'full-access',
      'default', NULL, NULL, ${input.latestTurnId}, '2026-04-13T00:00:00.000Z',
      '2026-04-13T00:00:00.000Z', NULL, NULL, 0, 0, 0, NULL
    )
  `;
  });

const insertTurn = (input: {
  readonly threadId: string;
  readonly turnId: string | null;
  readonly requestedAt: string;
  readonly completedAt: string | null;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
    INSERT INTO projection_turns (
      thread_id, turn_id, pending_message_id, assistant_message_id, state,
      requested_at, started_at, completed_at, checkpoint_turn_count,
      checkpoint_ref, checkpoint_status, checkpoint_files_json,
      source_proposed_plan_thread_id, source_proposed_plan_id
    ) VALUES (
      ${input.threadId}, ${input.turnId}, NULL, NULL,
      ${input.completedAt === null ? "running" : "completed"},
      ${input.requestedAt}, ${input.requestedAt}, ${input.completedAt},
      NULL, NULL, NULL, '[]', NULL, NULL
    )
  `;
  });

const readRepairedThreads = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{
    readonly threadId: string;
    readonly latestTurnId: string | null;
    readonly hasActionableProposedPlan: number;
  }>`
    SELECT
      thread_id AS "threadId",
      latest_turn_id AS "latestTurnId",
      has_actionable_proposed_plan AS "hasActionableProposedPlan"
    FROM projection_threads
    ORDER BY thread_id
  `;
});

layer("041_RepairProjectionThreadsLatestTurn", (it) => {
  it.effect("points erased latest turns back at the thread's most recent turn", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 40 });

      // Erased by the old session-set projector: turns on record, no pointer.
      yield* insertThread({ threadId: "thread-erased", latestTurnId: null });
      yield* insertTurn({
        threadId: "thread-erased",
        turnId: "turn-old",
        requestedAt: "2026-04-13T00:00:00.000Z",
        completedAt: "2026-04-13T00:01:00.000Z",
      });
      yield* insertTurn({
        threadId: "thread-erased",
        turnId: "turn-new",
        requestedAt: "2026-04-13T00:02:00.000Z",
        completedAt: "2026-04-13T00:03:00.000Z",
      });
      // A pending turn-start row carries no turn id and must never be chosen.
      yield* insertTurn({
        threadId: "thread-erased",
        turnId: null,
        requestedAt: "2026-04-13T00:09:00.000Z",
        completedAt: null,
      });

      // Already correct — must be left exactly as it is, even though a later
      // turn exists.
      yield* insertThread({ threadId: "thread-intact", latestTurnId: "turn-intact" });
      yield* insertTurn({
        threadId: "thread-intact",
        turnId: "turn-intact",
        requestedAt: "2026-04-13T00:00:00.000Z",
        completedAt: "2026-04-13T00:01:00.000Z",
      });
      yield* insertTurn({
        threadId: "thread-intact",
        turnId: "turn-later",
        requestedAt: "2026-04-13T00:05:00.000Z",
        completedAt: "2026-04-13T00:06:00.000Z",
      });

      // Never ran a turn: nothing to reconstruct, stays null.
      yield* insertThread({ threadId: "thread-fresh", latestTurnId: null });

      // Repaired rows must also get their latest-turn-derived plan flag back.
      yield* insertThread({ threadId: "thread-plan", latestTurnId: null });
      yield* insertTurn({
        threadId: "thread-plan",
        turnId: "turn-plan",
        requestedAt: "2026-04-13T00:00:00.000Z",
        completedAt: "2026-04-13T00:01:00.000Z",
      });
      yield* sql`
        INSERT INTO projection_thread_proposed_plans (
          plan_id, thread_id, turn_id, plan_markdown, created_at, updated_at,
          implemented_at, implementation_thread_id
        ) VALUES (
          'plan-1', 'thread-plan', 'turn-plan', '# Plan',
          '2026-04-13T00:01:00.000Z', '2026-04-13T00:01:00.000Z', NULL, NULL
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 41 });

      assert.deepEqual(yield* readRepairedThreads, [
        { threadId: "thread-erased", latestTurnId: "turn-new", hasActionableProposedPlan: 0 },
        { threadId: "thread-fresh", latestTurnId: null, hasActionableProposedPlan: 0 },
        { threadId: "thread-intact", latestTurnId: "turn-intact", hasActionableProposedPlan: 0 },
        { threadId: "thread-plan", latestTurnId: "turn-plan", hasActionableProposedPlan: 1 },
      ]);
    }),
  );
});
