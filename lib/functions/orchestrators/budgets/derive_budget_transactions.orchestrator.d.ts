/**
 * Derive Budget Transactions (orchestrator)
 *
 * READ-ONLY (Derive-On-Read): the transactions a budget owns FOR A PERIOD,
 * resolved ON READ (category + manual pin + Everything-Else fallback) — not from a
 * stored `budgetId`. Each owned split is tagged with a DERIVED display status:
 *   - counted  → contributes to Spent
 *   - ignored  → excluded from Spent but VISIBLE + user-manageable. Reasons:
 *       transfer (internal account transfer, matched-pair), income (real INCOME_*),
 *       manual (user set spendStatus='ignored')
 *   - refund   → money back (spendStatus='refund')
 * Recurring-linked splits (outflow/inflow) are omitted — they're tracked as bills/income.
 *
 * This lets the budget-detail screen show ignored items (incl. auto-ignored
 * transfers) in a dedicated section, with the pill to include them if desired.
 *
 * @module orchestrators/budgets/derive_budget_transactions
 */
import { TraceContext } from "../../types";
export type DerivedSpendStatus = "counted" | "ignored" | "refund";
export type IgnoredReason = "transfer" | "income" | "manual" | null;
export interface DerivedBudgetTransaction {
    transaction_id: string;
    split_id: string | null;
    date_ms: number;
    name: string;
    amount: number;
    is_pending: boolean;
    spend_status: DerivedSpendStatus;
    ignored_reason: IgnoredReason;
}
export declare function derive_budget_transactions_orchestrator(ctx: TraceContext, user_id: string, budget_id: string, start_ms: number, end_ms: number): Promise<DerivedBudgetTransaction[]>;
//# sourceMappingURL=derive_budget_transactions.orchestrator.d.ts.map