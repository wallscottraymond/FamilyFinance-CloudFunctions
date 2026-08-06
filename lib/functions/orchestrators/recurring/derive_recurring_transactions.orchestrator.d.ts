/**
 * Derive Recurring Transactions (orchestrator)
 *
 * READ-ONLY: every transaction that belongs to a recurring inflow/outflow stream,
 * for its detail screen. Source of truth is the stream's own `transaction_ids`
 * (Plaid links them; matched to our transactions by the `transactionId` field).
 * Each row is flagged `in_period` for the currently-viewed window so the screen
 * can render a "This Period" section and a "Historical" (all-time) section.
 *
 * @module orchestrators/recurring/derive_recurring_transactions
 */
import { TraceContext } from "../../types";
export type RecurringKind = "outflow" | "inflow";
export interface DerivedRecurringTransaction {
    transaction_id: string;
    date_ms: number;
    name: string;
    amount: number;
    is_pending: boolean;
    in_period: boolean;
}
export declare function derive_recurring_transactions_orchestrator(ctx: TraceContext, user_id: string, recurring_id: string, kind: RecurringKind, window_start_ms: number, window_end_ms: number): Promise<DerivedRecurringTransaction[]>;
//# sourceMappingURL=derive_recurring_transactions.orchestrator.d.ts.map