/**
 * Assign Recurring Transactions Orchestrator
 * (the `assign_recurring_transactions` job body)
 *
 * When a recurring item (outflow/inflow) is newly created, its historical
 * transactions were synced + assigned BEFORE the item (and its periods) existed,
 * so their splits never got `outflowId`/`inflowId` set — which budget
 * recurring-exclusion depends on. This job re-runs the assignment engine for the
 * item's transactions so those links are set now that the periods exist.
 *
 * Thin: load the recurring doc's `transactionIds` (Plaid ids) → resolve to
 * Firestore doc ids → delegate to the existing `assign_transactions_batch`
 * orchestrator (which sets the recurring link per split and fans out the
 * reconcile + budget recompute).
 *
 * @module orchestrators/recurring/assign_recurring_transactions
 */

import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { outflow_repo } from "../../repositories/outflow.repo";
import { inflow_repo } from "../../repositories/inflow.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import { assign_transactions_batch_orchestrator } from "../transactions/assign_transactions_batch.orchestrator";
import { RecurringType } from "../../resolvers/recurring/period_reconciliation.resolver";

export interface AssignRecurringTransactionsInput {
  recurring_id: string;
  recurring_type: RecurringType;
  user_id: string;
  trace_id: string;
}

export interface AssignRecurringTransactionsResult {
  transactions_assigned: number;
  success: boolean;
}

export async function assign_recurring_transactions_orchestrator(
  ctx: TraceContext,
  input: AssignRecurringTransactionsInput
): Promise<AssignRecurringTransactionsResult> {
  const span = create_span(ctx, "orchestrator", "assign_recurring_transactions");
  log_operation_start(span, input.user_id);

  try {
    // 1. Recurring doc → its Plaid transaction ids (the stream's membership).
    const recurring =
      input.recurring_type === "outflow"
        ? await outflow_repo.get_by_id(ctx, input.recurring_id)
        : await inflow_repo.get_by_id(ctx, input.recurring_id);
    const plaid_ids: string[] = recurring?.transaction_ids ?? [];
    if (plaid_ids.length === 0) {
      log_operation_success(span, input.user_id);
      return { transactions_assigned: 0, success: true };
    }

    // 2. Resolve Plaid ids → active Firestore transaction doc ids.
    const txns = await transaction_repo.get_by_plaid_transaction_ids(
      ctx,
      input.user_id,
      plaid_ids
    );
    const doc_ids = txns.filter((t) => t.isActive !== false).map((t) => t.id);
    if (doc_ids.length === 0) {
      log_operation_success(span, input.user_id);
      return { transactions_assigned: 0, success: true };
    }

    // 3. Re-run the engine for those transactions (sets the recurring link per
    //    split; the engine fans out reconcile + budget recompute for touched docs).
    await assign_transactions_batch_orchestrator(ctx, {
      user_id: input.user_id,
      transaction_ids: doc_ids,
    });

    console.log(
      `[${ctx.trace_id}] assign_recurring_transactions: ${input.recurring_type}=${input.recurring_id}, ` +
        `transactions=${doc_ids.length}`
    );
    log_operation_success(span, input.user_id);
    return { transactions_assigned: doc_ids.length, success: true };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: input.user_id, error_code: "ASSIGN_RECURRING_TRANSACTIONS_FAILED" }
    );
    throw error;
  }
}
