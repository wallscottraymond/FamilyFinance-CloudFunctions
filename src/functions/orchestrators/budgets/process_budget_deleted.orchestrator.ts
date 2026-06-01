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
import { transaction_repo } from "../../repositories/transaction.repo";
import { resolve_budget_periods_for_summary } from "../../resolvers/summaries";
import { enqueue_user_summary_updates_by_type } from "../summaries";
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

  // Resolve the period IDs to delete (from the payload, or query if absent).
  const period_ids =
    payload.budget_period_ids.length > 0
      ? payload.budget_period_ids
      : await budget_period_repo.get_ids_by_budget_id(ctx, payload.budget_id);

  // 1a. Capture which user_summaries are affected BEFORE deleting the periods
  // (the period docs must still exist to resolve their period_type/source).
  let periods_by_type: Map<string, Set<string>> = new Map();
  if (period_ids.length > 0) {
    try {
      const resolved = await resolve_budget_periods_for_summary(ctx, period_ids);
      periods_by_type = resolved.periods_by_type;
    } catch (resolve_error) {
      console.error(
        `[${ctx.trace_id}] process_budget_deleted: summary pre-resolve failed (non-fatal):`,
        resolve_error
      );
    }
  }

  // 1b. Delete budget periods.
  if (period_ids.length > 0) {
    await budget_period_repo.delete_by_ids(ctx, period_ids);
  }

  // 2. Reassign transaction splits to Everything Else.
  if (
    payload.everything_else_budget_id &&
    payload.affected_transaction_ids.length > 0
  ) {
    const everything_else = await budget_repo.get_by_id(
      ctx,
      payload.everything_else_budget_id
    );
    await transaction_repo.reassign_splits_budget(
      ctx,
      payload.affected_transaction_ids,
      payload.budget_id,
      payload.everything_else_budget_id,
      everything_else?.name ?? "Everything Else"
    );
  }

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

  // 4. Recompute the affected user_summaries now that the periods are gone, so
  // the deleted budget drops out of each summary's budgets[]. Explicit here (not
  // relying solely on the budget_period DELETE trigger) so the cascade owns it.
  if (periods_by_type.size > 0) {
    try {
      await enqueue_user_summary_updates_by_type(ctx, payload.user_id, periods_by_type);
    } catch (summary_error) {
      console.error(
        `[${ctx.trace_id}] process_budget_deleted: summary update failed (non-fatal):`,
        summary_error
      );
    }
  }

  log_operation_success(span, payload.user_id);
}
