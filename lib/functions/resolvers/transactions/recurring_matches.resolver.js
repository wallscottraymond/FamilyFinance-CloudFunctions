"use strict";
/**
 * Recurring Matches Resolver
 *
 * READ-ONLY: for a transaction, find which of its splits match a recurring bill
 * (outflow) or recurring income (inflow) — producing the `outflow_id` / `inflow_id`
 * the assignment engine puts on the split. Loads candidate periods in a window
 * around the transaction date and runs the pure `match_recurring` scorer per split.
 *
 * - `expense` transactions → outflow (bill) candidates → `outflow_id`
 * - `income` transactions  → inflow (income) candidates → `inflow_id`
 * - `transfer` → neither.
 *
 * Composite indexes: `outflow_periods(userId, firstDueDateInPeriod)`,
 * `inflow_periods(userId, firstDueDateInPeriod)`.
 *
 * @module resolvers/transactions/recurring_matches
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_recurring_matches = resolve_recurring_matches;
const firestore_1 = require("firebase-admin/firestore");
const outflow_period_repo_1 = require("../../repositories/outflow_period.repo");
const inflow_period_repo_1 = require("../../repositories/inflow_period.repo");
const match_recurring_service_1 = require("../../domain/transactions/match_recurring.service");
const WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // ±90 days candidate window
function ms(value) {
    return value instanceof firestore_1.Timestamp ? value.toMillis() : null;
}
/** Outflow (bill) period candidates around the transaction date. */
async function load_outflow_candidates(ctx, user_id, txn_date_ms) {
    const docs = await outflow_period_repo_1.outflow_period_repo.get_in_due_window(ctx, user_id, txn_date_ms - WINDOW_MS, txn_date_ms + WINDOW_MS);
    return docs.map(({ id, data: d }) => {
        var _a, _b, _c, _d, _e, _f, _g;
        const meta = (_a = d.metadata) !== null && _a !== void 0 ? _a : {};
        const splits_on_period = (_b = d.transactionSplits) !== null && _b !== void 0 ? _b : [];
        return {
            period_id: id,
            recurring_id: d.outflowId,
            merchant_name: (_d = (_c = d.merchantName) !== null && _c !== void 0 ? _c : meta.outflowMerchantName) !== null && _d !== void 0 ? _d : null,
            // A single transaction settles ONE occurrence, so score against the
            // per-occurrence amount (fall back to the period total / amount due).
            expected_amount: (_g = (_f = (_e = d.amountPerOccurrence) !== null && _e !== void 0 ? _e : d.expectedAmount) !== null && _f !== void 0 ? _f : d.totalAmountDue) !== null && _g !== void 0 ? _g : 0,
            due_date_ms: ms(d.firstDueDateInPeriod),
            is_settled: splits_on_period.length > 0,
        };
    });
}
/** Inflow (income) period candidates around the transaction date. */
async function load_inflow_candidates(ctx, user_id, txn_date_ms) {
    const docs = await inflow_period_repo_1.inflow_period_repo.get_in_due_window(ctx, user_id, txn_date_ms - WINDOW_MS, txn_date_ms + WINDOW_MS);
    return docs.map(({ id, data: d }) => {
        var _a, _b, _c, _d;
        const transaction_ids = (_a = d.transactionIds) !== null && _a !== void 0 ? _a : [];
        return {
            period_id: id,
            recurring_id: d.inflowId,
            merchant_name: (_c = (_b = d.merchant) !== null && _b !== void 0 ? _b : d.payee) !== null && _c !== void 0 ? _c : null,
            expected_amount: (_d = d.expectedAmount) !== null && _d !== void 0 ? _d : 0,
            due_date_ms: ms(d.firstDueDateInPeriod),
            is_settled: transaction_ids.length > 0,
        };
    });
}
/**
 * Resolve the recurring (bill/income) matches for a transaction's splits.
 *
 * @param txn_type - Transaction type: `expense` → outflows, `income` → inflows.
 */
async function resolve_recurring_matches(ctx, user_id, txn_type, txn_merchant_name, txn_date_ms, splits) {
    const out = {};
    for (const s of splits) {
        out[s.split_id] = { outflow_id: null, inflow_id: null };
    }
    const is_income = txn_type === "income";
    const is_expense = txn_type === "expense";
    if (!is_income && !is_expense) {
        return out; // transfers match nothing
    }
    const candidates = is_expense
        ? await load_outflow_candidates(ctx, user_id, txn_date_ms)
        : await load_inflow_candidates(ctx, user_id, txn_date_ms);
    if (candidates.length === 0) {
        return out;
    }
    for (const s of splits) {
        const result = (0, match_recurring_service_1.match_recurring)({
            merchant_name: txn_merchant_name,
            // Match on magnitude so the amount score works regardless of the income
            // (negative) vs expense (positive) sign convention.
            amount: Math.abs(s.amount),
            date_ms: txn_date_ms,
        }, candidates);
        if (result.matched) {
            out[s.split_id] = is_expense
                ? { outflow_id: result.recurring_id, inflow_id: null }
                : { outflow_id: null, inflow_id: result.recurring_id };
        }
    }
    return out;
}
//# sourceMappingURL=recurring_matches.resolver.js.map