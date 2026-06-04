/**
 * Match Budget Domain Service
 *
 * Pure logic for assigning ONE transaction split to a budget by category + date.
 * Real budgets are matched by `category ∈ category_ids AND date ∈ [start, end]`;
 * if none owns the category for that date, the split falls to **Everything Else
 * as a STRUCTURAL FALLBACK** (EE is the `else`, never matched by its own
 * `category_ids`). This makes an unmatched split impossible as long as the user
 * has an Everything Else budget.
 *
 * Sequenced by the Transaction Assignment Engine AFTER the manual-pin check, so
 * this service never sees manually-pinned splits.
 *
 * NO async, NO IO, NO side effects. Time is injected as epoch ms.
 *
 * @module domain/transactions/match_budget
 */
/** The minimal split shape this matcher needs. */
export interface SplitForBudgetMatch {
    /** User-set category override (wins over the Plaid category). */
    internal_match_category: string | null;
    /** Plaid-derived category. */
    plaid_match_category: string | null;
}
/** A real (non-Everything-Else) budget, reduced to what matching needs. */
export interface BudgetForMatch {
    id: string;
    category_ids: string[];
    /** Budget start, epoch ms. */
    start_ms: number;
    /** Budget end, epoch ms — ignored when `is_ongoing`. */
    end_ms: number | null;
    is_ongoing: boolean;
}
/** Result of matching a split to a budget. */
export interface BudgetMatchResult {
    /** The owning budget id, or `"unassigned"` if there is no Everything Else budget. */
    budget_id: string;
    /** How the match was made. */
    reason: "category+date" | "everything_else_fallback" | "no_everything_else";
    /** The category that matched (null for the EE fallback). */
    matched_category: string | null;
    /** True when MORE THAN ONE real budget matched — a data-integrity (claims drift) signal. */
    tie: boolean;
}
/** Sentinel used when a split cannot be placed (no Everything Else budget exists). */
export declare const UNASSIGNED_BUDGET_ID = "unassigned";
/**
 * Resolve the split's effective category (user override wins).
 * PURE.
 */
export declare function resolve_split_category(split: SplitForBudgetMatch): string | null;
/**
 * Whether a transaction date falls within a budget's active range.
 * PURE.
 */
export declare function is_within_budget_range(txn_date_ms: number, budget: BudgetForMatch): boolean;
/**
 * Match a split to a budget by category + date, with Everything Else as the
 * structural fallback.
 *
 * @param split - The split's category fields
 * @param txn_date_ms - The transaction date in epoch ms
 * @param real_budgets - The user's REAL budgets (Everything Else EXCLUDED)
 * @param everything_else_budget_id - The EE budget id, or null if the user has none
 * @returns The owning budget id + the reason
 *
 * PURE FUNCTION.
 */
export declare function match_budget(split: SplitForBudgetMatch, txn_date_ms: number, real_budgets: BudgetForMatch[], everything_else_budget_id: string | null): BudgetMatchResult;
//# sourceMappingURL=match_budget.service.d.ts.map