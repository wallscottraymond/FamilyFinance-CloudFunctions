/**
 * Process Budget Deleted (Cascade Job Handler)
 *
 * Runs asynchronously after a budget document is deleted. Performs:
 * 1. Deletes all budget periods for the budget.
 * 2. Reassigns transaction splits that referenced it to Everything Else.
 * 3. Releases the budget's categories back to Everything Else.
 *
 * @module orchestrators/budgets/process_budget_deleted
 */

import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import { budget_repo } from "../../repositories/budget.repo";
import { budget_period_repo } from "../../repositories/budget_period.repo";
import { create_job } from "../../infrastructure/job_queue";
import { ProcessBudgetDeletedPayload } from "../../types/budgets/delete_budget.types";

/**
 * Processes the delete cascade.
 */
export async function process_budget_deleted_orchestrator(
  ctx: TraceContext,
  payload: ProcessBudgetDeletedPayload
): Promise<void> {
  const span = create_span(ctx, "orchestrator", "process_budget_deleted");
  log_operation_start(span, payload.user_id);

  // Diagnostic: the reassign-to-EE + EE recompute below is gated on these.
  console.log(
    `[${ctx.trace_id}] process_budget_deleted: budget=${payload.budget_id} ` +
      `affected_txns=${payload.affected_transaction_ids.length} ` +
      `ee=${payload.everything_else_budget_id ?? "none"} ` +
      `periods=${payload.budget_period_ids.length}`
  );

  // Resolve the period IDs to delete (from the payload, or query if absent).
  const period_ids =
    payload.budget_period_ids.length > 0
      ? payload.budget_period_ids
      : await budget_period_repo.get_ids_by_budget_id(ctx, payload.budget_id);

  // (user_summaries build retired)

  // 1b. Delete budget periods.
  if (period_ids.length > 0) {
    await budget_period_repo.delete_by_ids(ctx, period_ids);
  }

  // 2. Re-assign the deleted budget's transactions so each split lands on the correct budget (one
  //    that owns the category, else Everything Else). Use the ids the RESOLVER already computed
  //    (`payload.affected_transaction_ids`) — do NOT re-query `get_ids_referencing_budget`, which
  //    scanned the user's ENTIRE transactions collection TWICE (the live `transactions SELECT
  //    splitBudgetIds` read line). Assign them in ONE batch (shared context + candidates resolved
  //    once) instead of N per-transaction jobs.
  const affected = payload.affected_transaction_ids ?? [];
  if (affected.length > 0) {
    await create_job(
      "assign_transactions_batch",
      { user_id: payload.user_id, transaction_ids: affected },
      { trace_id: ctx.trace_id }
    );
  }
  console.log(
    `[${ctx.trace_id}] process_budget_deleted: re-assigned ${affected.length} ` +
      `transactions off deleted budget ${payload.budget_id} (batch)`
  );

  // 3. Release the deleted budget's categories back to Everything Else.
  if (
    payload.release_category_ids.length > 0 &&
    payload.everything_else_budget_id
  ) {
    await budget_repo.add_category_ids(
      ctx,
      payload.everything_else_budget_id,
      payload.release_category_ids,
      payload.user_id
    );
  }

  // 3b. Transfer the deleted budget's pending spread-rollover debt to Everything
  //     Else (mode chosen by the user; captured pre-delete in the resolver). The
  //     repo decrements EE periods' rolledOverAmount (→ remaining + summary), so
  //     the overspend still gets paid back rather than vanishing on delete.
  if (
    payload.rollover_transfer_mode &&
    payload.pending_rollover_by_type &&
    payload.pending_rollover_by_type.length > 0 &&
    payload.everything_else_budget_id
  ) {
    try {
      const ee_period_ids = await budget_period_repo.transfer_rollover_to_budget(
        ctx,
        payload.everything_else_budget_id,
        payload.pending_rollover_by_type,
        payload.rollover_transfer_mode
      );
      console.log(
        `[${ctx.trace_id}] process_budget_deleted: transferred rollover (${payload.rollover_transfer_mode}) ` +
          `to EE across ${ee_period_ids.length} period(s)`
      );
      // (user_summaries build retired)
    } catch (rollover_error) {
      console.error(
        `[${ctx.trace_id}] process_budget_deleted: rollover transfer failed (non-fatal):`,
        rollover_error
      );
    }
  }

  log_operation_success(span, payload.user_id);
}
