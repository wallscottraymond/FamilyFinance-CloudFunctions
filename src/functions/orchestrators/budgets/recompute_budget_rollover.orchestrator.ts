/**
 * Recompute Budget Rollover Orchestrator
 *
 * The real-time half of the rollover system (the other half is the 3 AM
 * `calculateDailyRollover` catch-up). When the spend pipeline changes a budget's
 * `spent`, that budget's rollover chain becomes invalid — each period's
 * `rolledOverAmount` derives from the previous period's `allocated + rollover −
 * spent`. This orchestrator recomputes the chain and refreshes the summaries the
 * app renders.
 *
 * Dispatched from the `_jobs` queue as `recalculate_rollover`, enqueued by
 * `recompute_budget_spent` ONLY for budgets with `rolloverEnabled` (see there).
 *
 * Loop-safety: the chain writes `rolledOverAmount`/`remaining` but NEVER `spent`,
 * and rollover jobs are enqueued solely from the spend pipeline (driven by
 * transaction writes) — so a rollover write cannot re-enter the spend pipeline
 * or re-enqueue itself.
 *
 * NOTE (legacy coupling): the chain math + its period query/writes live in the
 * legacy `budgets/utils/rolloverChainCalculation` (owns its own reads/writes,
 * like a scoped repo). This orchestrator delegates to it — the same pattern
 * `process_budget_period_edited` uses for the sync utils.
 *
 * @module orchestrators/budgets/recompute_budget_rollover
 */

import * as admin from "firebase-admin";
import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { recalculateRolloverChain } from "../../budgets/utils/rolloverChainCalculation";
import { enqueue_user_summary_updates_from_budget_periods } from "../summaries";

/** Payload from the spend pipeline's fan-out (dedup key = budget_id). */
export interface RecomputeBudgetRolloverInput {
  user_id: string;
  /** The budget whose spend changed → rollover chain is now invalid. */
  budget_id: string;
  /** Optional: recompute only from this period forward (else the whole chain). */
  start_from_period_id?: string;
}

/**
 * Recompute the rollover chain for one budget, then refresh the affected
 * summaries.
 *
 * @returns Count of periods whose rollover/remaining changed.
 */
export async function recompute_budget_rollover_orchestrator(
  ctx: TraceContext,
  input: RecomputeBudgetRolloverInput
): Promise<{ periods_updated: number }> {
  const span = create_span(ctx, "orchestrator", "recompute_budget_rollover");
  log_operation_start(span, input.user_id);

  try {
    const db = admin.firestore();

    const result = await recalculateRolloverChain(
      db,
      input.budget_id,
      input.start_from_period_id
    );

    if (!result.success) {
      // Surface as a throw so the job queue retries / DLQs it.
      throw new Error(
        `rollover chain failed for budget ${input.budget_id}: ${result.errors.join("; ")}`
      );
    }

    // Refresh only the summaries whose periods actually changed.
    if (result.updatedPeriodIds.length > 0) {
      try {
        await enqueue_user_summary_updates_from_budget_periods(
          ctx,
          input.user_id,
          result.updatedPeriodIds
        );
      } catch (summary_error) {
        console.error(
          `[${ctx.trace_id}] recompute_budget_rollover: summary update failed (non-fatal):`,
          summary_error
        );
      }
    }

    log_operation_success(span, input.user_id);
    return { periods_updated: result.periodsUpdated };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: input.user_id, error_code: "RECOMPUTE_BUDGET_ROLLOVER_FAILED" }
    );
    throw error;
  }
}
