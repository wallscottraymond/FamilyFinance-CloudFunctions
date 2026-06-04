/**
 * Recompute Budget Spent Orchestrator
 *
 * The Budget-Transaction-Spend-Pipeline consumer of the assignment engine's
 * fan-out. For each touched budget, finds the period(s) containing the
 * transaction's date and RECOMPUTES their `spent`/`pendingSpent`/`remaining`
 * from the currently-assigned splits (invalidation-based — never incremented),
 * then refreshes the affected user_summary documents.
 *
 * Dispatched from the `_jobs` queue as `recompute_budget_spent`.
 *
 * @module orchestrators/budgets/recompute_budget_spent
 */

import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { budget_period_repo } from "../../repositories/budget_period.repo";
import { compute_budget_spent } from "../../domain/budgets/budget_spend.service";
import { resolve_spend_splits } from "../../resolvers/budgets/budget_spend.resolver";
import { enqueue_user_summary_updates_from_budget_periods } from "../summaries";

/** Payload from the assignment engine's fan-out. */
export interface RecomputeBudgetSpentInput {
  user_id: string;
  /** Budgets whose spend may have changed (before ∪ after). */
  budget_ids: string[];
  /**
   * The transaction's date — scopes recompute to the period(s) containing it.
   * OMITTED by the backfill, which recomputes EVERY period of each budget
   * (needed because spent must be rebuilt even where no assignment changed).
   */
  transaction_date_ms?: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Recompute spent for the touched budgets' affected periods.
 *
 * @returns Count of periods updated.
 */
export async function recompute_budget_spent_orchestrator(
  ctx: TraceContext,
  input: RecomputeBudgetSpentInput
): Promise<{ periods_updated: number }> {
  const span = create_span(ctx, "orchestrator", "recompute_budget_spent");
  log_operation_start(span, input.user_id);

  try {
    const affected_period_ids: string[] = [];
    let periods_updated = 0;

    for (const budget_id of input.budget_ids) {
      const periods = await budget_period_repo.get_by_budget_id(ctx, budget_id);
      // Date-scoped (engine fan-out) recomputes only the period(s) containing
      // the txn date; full mode (backfill, no date) recomputes every period.
      const affected =
        input.transaction_date_ms === undefined
          ? periods
          : periods.filter(
            (p) =>
                input.transaction_date_ms! >= p.start_date.toMillis() &&
                input.transaction_date_ms! <= p.end_date.toMillis()
          );
      if (affected.length === 0) {
        continue;
      }

      const updates: Array<{
        id: string;
        spent: number;
        pending_spent: number;
        remaining: number;
      }> = [];
      for (const p of affected) {
        const start_ms = p.start_date.toMillis();
        const end_ms = p.end_date.toMillis();
        const splits = await resolve_spend_splits(
          ctx,
          input.user_id,
          budget_id,
          start_ms,
          end_ms
        );
        const { spent, pending_spent } = compute_budget_spent(
          budget_id,
          start_ms,
          end_ms,
          splits
        );
        const effective =
          p.effective_amount ?? p.allocated_amount + p.rolled_over_amount;
        updates.push({
          id: p.id,
          spent,
          pending_spent,
          remaining: round2(effective - spent),
        });
        affected_period_ids.push(p.id);
      }

      await budget_period_repo.update_spent(ctx, updates);
      periods_updated += updates.length;
    }

    // Refresh the summaries the app renders.
    if (affected_period_ids.length > 0) {
      try {
        await enqueue_user_summary_updates_from_budget_periods(
          ctx,
          input.user_id,
          affected_period_ids
        );
      } catch (summary_error) {
        console.error(
          `[${ctx.trace_id}] recompute_budget_spent: summary update failed (non-fatal):`,
          summary_error
        );
      }
    }

    log_operation_success(span, input.user_id);
    return { periods_updated };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: input.user_id, error_code: "RECOMPUTE_BUDGET_SPENT_FAILED" }
    );
    throw error;
  }
}
