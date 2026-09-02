/**
 * Budget Spend Match (read-time) Domain Service
 *
 * Derive-On-Read Period Architecture — the "instant budgets" unlock.
 *
 * Resolves which budget a split belongs to ON READ, from the split's category +
 * manual pin, instead of reading a pre-computed stored `budgetId`. This is what
 * lets a brand-new budget show its transactions immediately (no write-time
 * assignment cascade) while still honoring user intent.
 *
 * Precedence (the engine's existing order, run on read):
 *   1. manual pin (budget_assignment_source === "manual")  → that budget
 *   2. category match (reuses `match_budget`: detailed → first → overall slug)
 *   3. Everything-Else structural fallback (also from `match_budget`)
 * Rules (future) slot between 1 and 2 without changing this shape.
 *
 * Recurring-linked splits (outflow_id/inflow_id set) are still excluded from
 * budget spend by `is_countable` downstream, so this matcher can ignore them.
 *
 * PURE: no IO, no side effects. Reuses `match_budget` + `compute_budget_spent`
 * unchanged, so it stays consistent with the write-time engine's decisions.
 *
 * @module domain/budgets/budget_spend_match
 */
import { BudgetForMatch } from "../transactions/match_budget.service";
import { SplitForSpend, SpendStatusForSpend } from "./budget_spend.service";
/** A split with everything the read-time owner resolution + spend need. */
export interface SplitForOnReadMatch {
    amount: number;
    txn_date_ms: number;
    is_pending: boolean;
    is_transfer: boolean;
    /** Transaction-level credit (`type: "income"`) — drives return-vs-spend direction. */
    is_income: boolean;
    spend_status: SpendStatusForSpend;
    outflow_id: string | null;
    inflow_id: string | null;
    /** Txn is in a recurring bill/income Plaid stream (even if this split's link is
     *  unset) → excluded from budget spend (S5). Optional; defaults false. */
    is_recurring_member?: boolean;
    internal_match_category: string | null;
    plaid_match_category: string | null;
    overall_category_id?: string | null;
    first_category_id?: string | null;
    /** Manual budget pin (user assigned this split to a budget); null otherwise. */
    manual_pin_budget_id: string | null;
}
/**
 * Resolve the budget a split belongs to on read.
 *
 * @param split        - The split's category + pin
 * @param real_budgets - The user's REAL budgets (Everything Else EXCLUDED)
 * @param ee_budget_id - The Everything-Else budget id, or null if none
 *
 * PURE.
 */
export declare function resolve_split_owner(split: SplitForOnReadMatch, real_budgets: BudgetForMatch[], ee_budget_id: string | null): string;
/**
 * The splits owned by `target_budget_id` on read, mapped to `SplitForSpend`
 * (with `budget_id` stamped to the target) so they flow straight into the
 * existing spend/derivation path.
 *
 * PURE.
 */
export declare function owned_splits_for_budget(target_budget_id: string, real_budgets: BudgetForMatch[], ee_budget_id: string | null, splits: SplitForOnReadMatch[]): SplitForSpend[];
//# sourceMappingURL=budget_spend_match.service.d.ts.map