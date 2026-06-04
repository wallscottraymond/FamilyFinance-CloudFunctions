"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNASSIGNED_BUDGET_ID = void 0;
exports.resolve_split_category = resolve_split_category;
exports.is_within_budget_range = is_within_budget_range;
exports.match_budget = match_budget;
/** Sentinel used when a split cannot be placed (no Everything Else budget exists). */
exports.UNASSIGNED_BUDGET_ID = "unassigned";
/**
 * Resolve the split's effective category (user override wins).
 * PURE.
 */
function resolve_split_category(split) {
    return split.internal_match_category || split.plaid_match_category || null;
}
/**
 * Whether a transaction date falls within a budget's active range.
 * PURE.
 */
function is_within_budget_range(txn_date_ms, budget) {
    if (txn_date_ms < budget.start_ms) {
        return false;
    }
    if (budget.is_ongoing) {
        return true;
    }
    return budget.end_ms !== null && txn_date_ms <= budget.end_ms;
}
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
function match_budget(split, txn_date_ms, real_budgets, everything_else_budget_id) {
    const category = resolve_split_category(split);
    // Collect every real budget that owns this category for this date. By the
    // claims-exclusivity invariant there should be at most one; collecting all
    // lets us flag drift (tie) without changing the result.
    let first_match = null;
    let match_count = 0;
    if (category) {
        for (const budget of real_budgets) {
            if (budget.category_ids.includes(category) &&
                is_within_budget_range(txn_date_ms, budget)) {
                match_count++;
                if (first_match === null) {
                    first_match = budget;
                }
            }
        }
    }
    if (first_match) {
        return {
            budget_id: first_match.id,
            reason: "category+date",
            matched_category: category,
            tie: match_count > 1,
        };
    }
    // Structural fallback → Everything Else (NOT matched by its category_ids).
    if (everything_else_budget_id) {
        return {
            budget_id: everything_else_budget_id,
            reason: "everything_else_fallback",
            matched_category: null,
            tie: false,
        };
    }
    // No Everything Else budget — only way to be unmatched. Orchestrator logs ERROR.
    return {
        budget_id: exports.UNASSIGNED_BUDGET_ID,
        reason: "no_everything_else",
        matched_category: null,
        tie: false,
    };
}
//# sourceMappingURL=match_budget.service.js.map