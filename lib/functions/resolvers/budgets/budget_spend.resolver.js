"use strict";
/**
 * Budget Spend Resolver
 *
 * READ-ONLY: gather the transaction splits assigned to a budget within a period's
 * date range, mapped to the spend domain's input. Uses a `transactionDate` range
 * query (top-level, indexable) + an in-memory filter on `split.budgetId` — the
 * splits-read constraint (splits are an array of maps and can't be queried by an
 * inner field). Bounded to one period's transactions.
 *
 * Composite index required: `transactions(userId ASC, transactionDate ASC)`.
 *
 * @module resolvers/budgets/budget_spend
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_spend_splits = resolve_spend_splits;
const transaction_repo_1 = require("../../repositories/transaction.repo");
const budget_spend_service_1 = require("../../domain/budgets/budget_spend.service");
const on_read_matching_1 = require("../shared/on_read_matching");
/** Which split field carries the budget assignment for each period lens. */
const LENS_FIELD = {
    monthly: "monthlyBudgetId",
    weekly: "weeklyBudgetId",
    bi_monthly: "biWeeklyBudgetId",
};
/**
 * Resolve the spend splits for a (budget, period date range).
 *
 * Per-Period-EE: a split is assigned INDEPENDENTLY per lens, so we match the split
 * field for THIS budget's cadence (`cadence` = the budget's own `period`, applied
 * to all its periods — prime and non-prime). Pre-migration docs only have the
 * legacy `budgetId` (= the monthly assignment), so the monthly lens falls back to
 * it; weekly/bi_monthly match only their own field.
 *
 * @returns Every countable-candidate split assigned to `budget_id` in the range.
 */
async function resolve_spend_splits(ctx, user_id, budget_id, start_ms, end_ms, cadence = "monthly") {
    var _a, _b, _c, _d, _e, _f;
    const txns = await transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, user_id, start_ms, end_ms);
    // Matched-pair internal-transfer detection: only OWN-account transfers (a matching
    // opposite leg on another account) are excluded — external ACH bills that Plaid
    // tags TRANSFER (mortgage, rent) stay countable. Same rule as the on-read paths.
    const { internal_ids } = (0, on_read_matching_1.detect_internal_transfers_from_txns)(txns);
    const lens_field = LENS_FIELD[cadence];
    const out = [];
    for (const { id, data: d } of txns) {
        const txn_date_ms = d.transactionDate.toMillis();
        const is_pending = d.isPending === true;
        const txn_is_internal_transfer = internal_ids.has(id);
        const txn_is_income = d.type === "income";
        const splits = (_a = d.splits) !== null && _a !== void 0 ? _a : [];
        for (const s of splits) {
            // The split's assignment in this budget's lens; monthly falls back to the
            // legacy `budgetId` for pre-migration docs.
            let assigned = s[lens_field];
            if (assigned === undefined && cadence === "monthly") {
                assigned = s.budgetId;
            }
            if (assigned !== budget_id) {
                continue;
            }
            const effective_category = (_b = s.internalDetailedCategory) !== null && _b !== void 0 ? _b : s.plaidDetailedCategory;
            out.push({
                budget_id,
                amount: (_c = s.amount) !== null && _c !== void 0 ? _c : 0,
                txn_date_ms,
                is_pending,
                // Only INTERNAL (matched-pair own-account) transfers are excluded from spend
                // by is_countable — external ACH bills tagged TRANSFER stay countable.
                is_transfer: txn_is_internal_transfer,
                is_income: txn_is_income,
                is_income_category: (0, budget_spend_service_1.is_income_category)(effective_category),
                // Derive on read (no migration): explicit spendStatus wins, else fall back
                // to the legacy isIgnored/isRefund booleans, else 'counted'.
                spend_status: (_d = s.spendStatus) !== null && _d !== void 0 ? _d : (s.isIgnored === true
                    ? "ignored"
                    : s.isRefund === true
                        ? "refund"
                        : "counted"),
                outflow_id: (_e = s.outflowId) !== null && _e !== void 0 ? _e : null,
                inflow_id: (_f = s.inflowId) !== null && _f !== void 0 ? _f : null,
            });
        }
    }
    return out;
}
//# sourceMappingURL=budget_spend.resolver.js.map