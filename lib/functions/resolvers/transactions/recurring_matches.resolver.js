"use strict";
/**
 * Recurring Matches Resolver
 *
 * READ-ONLY: for a transaction, find which of its splits match a recurring bill
 * (outflow) — producing the `outflow_id` the assignment engine puts on the
 * split. Loads candidate outflow periods in a window around the transaction
 * date and runs the pure `match_recurring` scorer per split.
 *
 * Inflow (income) matching is deferred to Recurring-Period-Reconciliation (the
 * inflow-period reconciliation is new); `inflow_id` stays null for now.
 *
 * Composite index: `outflow_periods(userId ASC, expectedDueDate ASC)`.
 *
 * @module resolvers/transactions/recurring_matches
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_recurring_matches = resolve_recurring_matches;
const outflow_period_repo_1 = require("../../repositories/outflow_period.repo");
const match_recurring_service_1 = require("../../domain/transactions/match_recurring.service");
const WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // ±90 days candidate window
/**
 * Resolve the recurring (bill) matches for a transaction's splits.
 *
 * @param splits - The splits (split_id + amount) to match
 * @param txn_type - Transaction type; only `expense` matches outflows
 */
async function resolve_recurring_matches(ctx, user_id, txn_type, txn_merchant_name, txn_date_ms, splits) {
    const out = {};
    for (const s of splits) {
        out[s.split_id] = { outflow_id: null, inflow_id: null };
    }
    // Only expenses match bills (transfers/income don't).
    if (txn_type !== "expense") {
        return out;
    }
    // Load candidate outflow periods in a window around the transaction date.
    const period_docs = await outflow_period_repo_1.outflow_period_repo.get_in_due_window(ctx, user_id, txn_date_ms - WINDOW_MS, txn_date_ms + WINDOW_MS);
    const candidates = period_docs.map(({ id, data: d }) => {
        var _a, _b, _c, _d, _e;
        const meta = (_a = d.metadata) !== null && _a !== void 0 ? _a : {};
        const splits_on_period = (_b = d.transactionSplits) !== null && _b !== void 0 ? _b : [];
        return {
            period_id: id,
            recurring_id: d.outflowId,
            merchant_name: (_d = (_c = d.merchantName) !== null && _c !== void 0 ? _c : meta.outflowMerchantName) !== null && _d !== void 0 ? _d : null,
            expected_amount: (_e = d.amountDue) !== null && _e !== void 0 ? _e : 0,
            due_date_ms: d.expectedDueDate
                ? d.expectedDueDate.toMillis()
                : null,
            is_settled: splits_on_period.length > 0,
        };
    });
    if (candidates.length === 0) {
        return out;
    }
    for (const s of splits) {
        const result = (0, match_recurring_service_1.match_recurring)({ merchant_name: txn_merchant_name, amount: s.amount, date_ms: txn_date_ms }, candidates);
        if (result.matched) {
            out[s.split_id] = { outflow_id: result.recurring_id, inflow_id: null };
        }
    }
    return out;
}
//# sourceMappingURL=recurring_matches.resolver.js.map