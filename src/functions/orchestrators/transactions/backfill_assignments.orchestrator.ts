/**
 * Backfill Assignments Orchestrator
 *
 * One-shot migration: re-run the Transaction Assignment Engine over existing
 * data so split assignments become engine-authoritative AND every budget
 * period's `spent` is rebuilt (invalidation-based) off the assigned splits.
 * Intended to run once right after the hard cutover off the legacy increment
 * model. Fully idempotent — safe to re-run.
 *
 * Self-fanning (one job type, no coordinator proliferation):
 *   - no `user_id` → enumerate users, enqueue one `backfill_assignments` job
 *     per user (so each user is its own ≤5-min job).
 *   - with `user_id` → enqueue `assign_transaction` per transaction (re-assign;
 *     fans out a date-scoped recompute only where assignment CHANGED) AND a FULL
 *     `recompute_budget_spent` per budget (rebuilds spent for EVERY period,
 *     covering the periods where assignment did NOT change but the legacy
 *     increment left stale/`$0` spent).
 *
 * Why both passes: `assign_transaction` skips the recompute fan-out when nothing
 * changed (loop prevention), so a per-budget full recompute is required to
 * guarantee all spent is correct — including periods that have no transactions
 * but carry a phantom balance from the old model.
 *
 * @module orchestrators/transactions/backfill_assignments
 */

import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { create_job } from "../../infrastructure/job_queue";
import { enqueue_reassign_user } from "./reassign_user.orchestrator";
import { budget_period_repo } from "../../repositories/budget_period.repo";
import {
  build_self_provision_budget_created_payload,
  compute_ee_coverage_start,
} from "../../domain/budgets";
import { resolve_backfill_user_ids } from "../../resolvers/transactions/backfill_targets.resolver";
import { budget_repo } from "../../repositories/budget.repo";

/** Input: backfill one user, or (no user_id) fan out to all users. */
export interface BackfillAssignmentsInput {
  user_id?: string;
  /** Report what would change (a `_reassign_runs` doc) without writing any transaction. */
  dry_run?: boolean;
}

/** Result summary (handy for logs/tests). */
export interface BackfillAssignmentsResult {
  mode: "fan_out_users" | "user";
  users_enqueued?: number;
  transactions_enqueued?: number;
  budgets_enqueued?: number;
  /** Budgets that had no periods and were re-provisioned (legacy EE budget). */
  budgets_healed?: number;
}

/** Bounded-concurrency enqueue so a large work-list doesn't open thousands of
 * sockets at once. Each create_job is a single Firestore write. */
const ENQUEUE_CHUNK = 50;

async function enqueue_chunked(
  thunks: Array<() => Promise<unknown>>
): Promise<void> {
  for (let i = 0; i < thunks.length; i += ENQUEUE_CHUNK) {
    const chunk = thunks.slice(i, i + ENQUEUE_CHUNK);
    await Promise.all(chunk.map((t) => t()));
  }
}

export async function backfill_assignments_orchestrator(
  ctx: TraceContext,
  input: BackfillAssignmentsInput
): Promise<BackfillAssignmentsResult> {
  const span = create_span(ctx, "orchestrator", "backfill_assignments");
  log_operation_start(span, input.user_id ?? "ALL");

  try {
    // Fan-out mode: enqueue one per-user backfill job.
    if (!input.user_id) {
      const user_ids = await resolve_backfill_user_ids(ctx);
      await enqueue_chunked(
        user_ids.map((user_id) => (): Promise<unknown> =>
          create_job(
            "backfill_assignments",
            { user_id, dry_run: input.dry_run === true },
            { trace_id: ctx.trace_id }
          )
        )
      );
      console.log(
        `[${ctx.trace_id}] backfill_assignments: fanned out ${user_ids.length} users`
      );
      log_operation_success(span, "ALL");
      return { mode: "fan_out_users", users_enqueued: user_ids.length };
    }

    // Per-user mode: ONE bounded re-assign run (3-R — date-ordered pages, legacy overrides
    // carried into user picks, written once, one follow-up), then heal budgets missing periods.
    const budgets = await budget_repo.get_by_user_id(ctx, input.user_id);
    await enqueue_reassign_user(
      { user_id: input.user_id, reason: "backfill", dry_run: input.dry_run === true },
      ctx.trace_id
    );

    // 2. Heal: any budget with NO periods (the legacy Everything Else budget is
    //    created without the v2 cascade) gets its periods + summaries generated.
    //    Without periods it can't render in the app or hold spend.
    let budgets_healed = 0;
    for (const b of budgets) {
      const period_ids = await budget_period_repo.get_ids_by_budget_id(ctx, b.id);
      if (period_ids.length > 0) {
        continue;
      }
      const heal_payload = build_self_provision_budget_created_payload({
        budget_id: b.id,
        user_id: input.user_id,
        group_ids: b.group_ids,
        budget_name: b.name,
        category_ids: b.category_ids,
        amount: b.amount,
        period: b.period,
        start: b.start_date.toDate(),
        is_ongoing: b.is_ongoing,
        budget_end_date: b.budget_end_date ? b.budget_end_date.toDate() : null,
        // The Everything Else catch-all backdates its window to cover imported
        // historical transactions; regular budgets stay forward-from-start.
        coverage_start: b.is_system_everything_else
          ? compute_ee_coverage_start(b.start_date.toDate())
          : null,
      });
      await create_job("process_budget_created", heal_payload, {
        trace_id: ctx.trace_id,
      });
      budgets_healed++;
    }

    console.log(
      `[${ctx.trace_id}] backfill_assignments: user=${input.user_id} enqueued ` +
        `reassign_user (dry_run=${input.dry_run === true}) + ${budgets_healed} heal jobs`
    );
    log_operation_success(span, input.user_id);
    return { mode: "user", budgets_healed };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: input.user_id ?? "ALL", error_code: "BACKFILL_ASSIGNMENTS_FAILED" }
    );
    throw error;
  }
}
