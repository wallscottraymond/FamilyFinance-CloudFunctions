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
exports.is_within_budget_range = is_within_budget_range;
exports.match_budget = match_budget;
/** Sentinel used when a split cannot be placed (no Everything Else budget exists). */
exports.UNASSIGNED_BUDGET_ID = "unassigned";
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
    var _a;
    // Slugs only (canon A2): a budget owns the split when it lists the split's first category.
    // `match_count` still flags multi-budget claims (drift) without changing the result.
    const first = (_a = split.first_category_id) !== null && _a !== void 0 ? _a : null;
    let best = null;
    let match_count = 0;
    for (const budget of real_budgets) {
        if (!first || !is_within_budget_range(txn_date_ms, budget)) {
            continue;
        }
        if (budget.category_ids.includes(first)) {
            match_count++;
            if (best === null)
                best = { budget, matched: first };
        }
    }
    if (best) {
        return {
            budget_id: best.budget.id,
            reason: "category+date",
            matched_category: best.matched,
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