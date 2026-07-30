import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

/**
 * Repair threads whose `latest_turn_id` was erased when their session went
 * ready.
 *
 * The `thread.session-set` projector used to write `session.activeTurnId`
 * straight into `latest_turn_id`, so ending a turn (ready/stopped/error, all of
 * which carry a null activeTurnId) also erased which turn had just run. Only a
 * following `thread.turn-diff-completed` put it back, so any turn that touched
 * no files left the thread with no latest turn at all: the shell reported
 * neither "working" nor "completed", and the settle guard read the thread's
 * last user message as a turn start nothing had ever adopted.
 *
 * The projector no longer clears the column, but existing rows are already
 * wrong and projections are cursor-checkpointed rather than replayed, so point
 * them back at their most recent recorded turn. Rows that still hold a turn id
 * are left alone — only the erased ones are reconstructed.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE projection_threads
    SET latest_turn_id = (
      SELECT turn.turn_id
      FROM projection_turns AS turn
      WHERE turn.thread_id = projection_threads.thread_id
        AND turn.turn_id IS NOT NULL
      ORDER BY
        COALESCE(turn.completed_at, turn.started_at, turn.requested_at) DESC,
        turn.row_id DESC
      LIMIT 1
    )
    WHERE latest_turn_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM projection_turns AS turn
        WHERE turn.thread_id = projection_threads.thread_id
          AND turn.turn_id IS NOT NULL
      )
  `;

  // `has_actionable_proposed_plan` is derived from the latest turn, so every
  // repaired row needs it recomputed. Mirrors the derivation in
  // refreshThreadShellSummary: a plan on the latest turn wins, otherwise the
  // newest plan on the thread, and either only counts while unimplemented.
  yield* sql`
    UPDATE projection_threads
    SET has_actionable_proposed_plan = COALESCE((
      SELECT CASE
        WHEN projection_threads.latest_turn_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM projection_thread_proposed_plans AS latest_turn_plan_exists
            WHERE latest_turn_plan_exists.thread_id = projection_threads.thread_id
              AND latest_turn_plan_exists.turn_id = projection_threads.latest_turn_id
          )
          THEN CASE
            WHEN (
              SELECT latest_turn_plan.implemented_at
              FROM projection_thread_proposed_plans AS latest_turn_plan
              WHERE latest_turn_plan.thread_id = projection_threads.thread_id
                AND latest_turn_plan.turn_id = projection_threads.latest_turn_id
              ORDER BY latest_turn_plan.updated_at DESC, latest_turn_plan.plan_id DESC
              LIMIT 1
            ) IS NULL
              THEN 1
              ELSE 0
            END
        WHEN EXISTS (
          SELECT 1
          FROM projection_thread_proposed_plans AS any_plan
          WHERE any_plan.thread_id = projection_threads.thread_id
        )
          THEN CASE
            WHEN (
              SELECT latest_plan.implemented_at
              FROM projection_thread_proposed_plans AS latest_plan
              WHERE latest_plan.thread_id = projection_threads.thread_id
              ORDER BY latest_plan.updated_at DESC, latest_plan.plan_id DESC
              LIMIT 1
            ) IS NULL
              THEN 1
              ELSE 0
            END
        ELSE 0
      END
    ), 0)
  `;
});
