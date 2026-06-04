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
/**
 * Resolve the spend splits for a (budget, period date range).
 *
 * @returns Every countable-candidate split assigned to `budget_id` in the range.
 */
async function resolve_spend_splits(ctx, user_id, budget_id, start_ms, end_ms) {
    var _a, _b, _c, _d;
    const txns = await transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, user_id, start_ms, end_ms);
    const out = [];
    for (const { data: d } of txns) {
        const txn_date_ms = d.transactionDate.toMillis();
        const is_pending = d.isPending === true;
        const is_transfer = d.type === "transfer";
        const splits = (_a = d.splits) !== null && _a !== void 0 ? _a : [];
        for (const s of splits) {
            if (s.budgetId !== budget_id) {
                continue;
            }
            out.push({
                budget_id,
                amount: (_b = s.amount) !== null && _b !== void 0 ? _b : 0,
                txn_date_ms,
                is_pending,
                is_transfer,
                is_ignored: s.isIgnored === true,
                outflow_id: (_c = s.outflowId) !== null && _c !== void 0 ? _c : null,
                inflow_id: (_d = s.inflowId) !== null && _d !== void 0 ? _d : null,
            });
        }
    }
    return out;
}
//# sourceMappingURL=budget_spend.resolver.js.map