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
export declare function assign_recurring_transactions_orchestrator(ctx: TraceContext, input: AssignRecurringTransactionsInput): Promise<AssignRecurringTransactionsResult>;
//# sourceMappingURL=assign_recurring_transactions.orchestrator.d.ts.map