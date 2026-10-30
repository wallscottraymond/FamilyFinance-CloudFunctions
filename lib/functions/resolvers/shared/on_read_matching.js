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
const budget_spend_service_1 = require("../../domain/budgets/budget_spend.service");
const internal_transfer_service_1 = require("../../domain/transactions/internal_transfer.service");
const category_semantics_service_1 = require("../../domain/transactions/category_semantics.service");
const split_category_service_1 = require("../../domain/transactions/split_category.service");
const split_category_edit_service_1 = require("../../domain/transactions/split_category_edit.service");
/**
 * Map a raw Firestore split (+ its transaction context) into the on-read matcher's
 * shape. The single source of truth for how a split's spendStatus, categories, and
 * manual pin are read.
 */
function map_raw_split_to_on_read_match(raw_split, ctx, catalog) {
    var _a, _b, _c, _d, _e, _f, _g;
    // The ONE category function (canon M7) via THE raw-split mapper — the same calls the assignment
    // engine makes, so the period page and the stored fields can't disagree.
    const category = (0, split_category_service_1.resolve_split_category)((0, split_category_edit_service_1.split_category_input_from_raw)(raw_split, { merchantName: (_a = ctx.merchant_name) !== null && _a !== void 0 ? _a : null, name: (_b = ctx.name) !== null && _b !== void 0 ? _b : null }, catalog), catalog);
    return {
        amount: (_c = raw_split.amount) !== null && _c !== void 0 ? _c : 0,
        txn_date_ms: ctx.txn_date_ms,
        is_pending: ctx.is_pending,
        // The transaction's internal-transfer flag applies to a split only while ITS category is a
        // transfer (a split the user re-categorized to spending counts as spending — as the engine
        // decides per split).
        is_transfer: ctx.is_transfer && (0, category_semantics_service_1.is_transfer_category)(category.semantic_code),
        is_income: ctx.is_income,
        spend_status: (0, budget_spend_service_1.split_spend_status)(raw_split),
        outflow_id: (_d = raw_split.outflowId) !== null && _d !== void 0 ? _d : null,
        inflow_id: (_e = raw_split.inflowId) !== null && _e !== void 0 ? _e : null,
        is_recurring_member: (_f = ctx.is_recurring_member) !== null && _f !== void 0 ? _f : false,
        first_category_id: category.first_category_id,
        semantic_code: category.semantic_code,
        manual_pin_budget_id: raw_split.budgetAssignmentSource === "manual"
            ? (_g = raw_split.budgetId) !== null && _g !== void 0 ? _g : null
            : null,
    };
}
/**
 * The category MEANING (a Plaid code) of a transaction for transfer pairing, from the ONE
 * category function (a user pick away from a transfer category makes that split spending): the
 * first split that is still a TRANSFER, else the first split. Order-independent — a transaction
 * with any transfer split pairs, whichever split comes first.
 */
function txn_effective_category(data, catalog) {
    var _a, _b;
    const splits = (_a = data.splits) !== null && _a !== void 0 ? _a : [];
    const codes = (splits.length ? splits : [{}]).map((s) => (0, split_category_service_1.resolve_split_category)((0, split_category_edit_service_1.split_category_input_from_raw)(s, data, catalog), catalog)
        .semantic_code);
    return (_b = codes.find((c) => (0, category_semantics_service_1.is_transfer_category)(c))) !== null && _b !== void 0 ? _b : codes[0];
}
/**
 * Detect INTERNAL (own-account matched-pair) transfers over a set of already-loaded
 * transactions. Builds the pure matcher's input from the raw docs, then runs
 * `detect_internal_transfers`. Returns internal doc-ids + Plaid-ids.
 */
function detect_internal_transfers_from_txns(txns, catalog) {
    var _a, _b, _c;
    const transfers = [];
    for (const { id, data } of txns) {
        const eff = txn_effective_category(data, catalog);
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