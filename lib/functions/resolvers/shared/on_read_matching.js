"use strict";
/**
 * Shared on-read matching helpers.
 *
 * ONE place that maps raw Firestore transaction/split data into the domain shapes
 * the on-read spend/matching path consumes — so every path (period derivation,
 * budget-view spend, budget-detail transactions, materialized recompute) reads a
 * split the same way and applies the SAME transfer rule. Previously this ~30-line
 * mapping and the matched-pair setup were copy-pasted across several resolvers,
 * which let them drift (notably: matched-pair vs blanket transfer detection).
 *
 * PURE: no IO. Callers load the transactions; these map the already-loaded data.
 *
 * @module resolvers/shared/on_read_matching
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.map_raw_split_to_on_read_match = map_raw_split_to_on_read_match;
exports.txn_effective_category = txn_effective_category;
exports.detect_internal_transfers_from_txns = detect_internal_transfers_from_txns;
const internal_transfer_service_1 = require("../../domain/transactions/internal_transfer.service");
const category_semantics_service_1 = require("../../domain/transactions/category_semantics.service");
/**
 * Map a raw Firestore split (+ its transaction context) into the on-read matcher's
 * shape. The single source of truth for how a split's spendStatus, categories, and
 * manual pin are read.
 */
function map_raw_split_to_on_read_match(raw_split, ctx) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const internal_category = (_a = raw_split.internalDetailedCategory) !== null && _a !== void 0 ? _a : null;
    const plaid_category = (_b = raw_split.plaidDetailedCategory) !== null && _b !== void 0 ? _b : "OTHER_EXPENSE";
    return {
        amount: (_c = raw_split.amount) !== null && _c !== void 0 ? _c : 0,
        txn_date_ms: ctx.txn_date_ms,
        is_pending: ctx.is_pending,
        is_transfer: ctx.is_transfer,
        is_income: ctx.is_income,
        spend_status: (_d = raw_split.spendStatus) !== null && _d !== void 0 ? _d : (raw_split.isIgnored === true
            ? "ignored"
            : raw_split.isRefund === true
                ? "refund"
                : "counted"),
        outflow_id: (_e = raw_split.outflowId) !== null && _e !== void 0 ? _e : null,
        inflow_id: (_f = raw_split.inflowId) !== null && _f !== void 0 ? _f : null,
        internal_match_category: internal_category,
        plaid_match_category: plaid_category,
        overall_category_id: (_g = raw_split.overallCategoryId) !== null && _g !== void 0 ? _g : null,
        first_category_id: (_h = raw_split.firstCategoryId) !== null && _h !== void 0 ? _h : null,
        manual_pin_budget_id: raw_split.budgetAssignmentSource === "manual"
            ? (_j = raw_split.budgetId) !== null && _j !== void 0 ? _j : null
            : null,
    };
}
/** The effective (internal-override-aware) category of a transaction's first split. */
function txn_effective_category(data) {
    var _a, _b, _c, _d;
    const first = (_b = ((_a = data.splits) !== null && _a !== void 0 ? _a : [])[0]) !== null && _b !== void 0 ? _b : {};
    return ((_d = (_c = first.internalDetailedCategory) !== null && _c !== void 0 ? _c : first.plaidDetailedCategory) !== null && _d !== void 0 ? _d : "");
}
/**
 * Detect INTERNAL (own-account matched-pair) transfers over a set of already-loaded
 * transactions. Builds the pure matcher's input from the raw docs, then runs
 * `detect_internal_transfers`. Returns internal doc-ids + Plaid-ids.
 */
function detect_internal_transfers_from_txns(txns) {
    var _a, _b, _c;
    const transfers = [];
    for (const { id, data } of txns) {
        const eff = txn_effective_category(data);
        if (!(0, category_semantics_service_1.is_transfer_category)(eff))
            continue;
        const raw = (_a = data.splits) !== null && _a !== void 0 ? _a : [];
        transfers.push({
            id,
            plaid_id: (_b = data.transactionId) !== null && _b !== void 0 ? _b : null,
            account_id: (_c = data.accountId) !== null && _c !== void 0 ? _c : "",
            amount: raw.reduce((s, sp) => { var _a; return s + Math.abs((_a = sp.amount) !== null && _a !== void 0 ? _a : 0); }, 0),
            date_ms: data.transactionDate.toMillis(),
            direction: eff.startsWith("TRANSFER_IN") ? "in" : "out",
        });
    }
    return (0, internal_transfer_service_1.detect_internal_transfers)(transfers);
}
//# sourceMappingURL=on_read_matching.js.map