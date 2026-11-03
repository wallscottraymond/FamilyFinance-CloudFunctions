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
exports.CARD_SIDE_WAIT_MS = void 0;
exports.card_payment_is_money_movement = card_payment_is_money_movement;
exports.map_raw_split_to_on_read_match = map_raw_split_to_on_read_match;
exports.txn_effective_category = txn_effective_category;
exports.detect_card_payment_pairs_from_txns = detect_card_payment_pairs_from_txns;
exports.detect_internal_transfers_from_txns = detect_internal_transfers_from_txns;
const budget_spend_service_1 = require("../../domain/budgets/budget_spend.service");
const internal_transfer_service_1 = require("../../domain/transactions/internal_transfer.service");
const category_semantics_service_1 = require("../../domain/transactions/category_semantics.service");
const split_category_service_1 = require("../../domain/transactions/split_category.service");
const split_category_edit_service_1 = require("../../domain/transactions/split_category_edit.service");
/** How long a paying side waits for its card side before counting as spending (D8): the pairing
 *  tolerance, so a payment that could still pair never counts first. */
exports.CARD_SIDE_WAIT_MS = 5 * 24 * 60 * 60 * 1000;
/**
 * Whether a card-payment split is money movement rather than spending (Trustworthy-Numbers D1):
 * the card-side credit always is, so a payment can never reduce spending; the paying side is only
 * when the card's side is in the view too, or may still be on its way. Otherwise the payment is the
 * only record of that spending here, so it counts. PURE.
 */
function card_payment_is_money_movement(semantic_code, ctx, 
/** The user chose this split's category: only a card-payment pick means a card payment. */
is_user_pick = false) {
    // A credit paired as a card side, whatever its code (D7: Chase labels its side differently).
    if (ctx.is_paired_card_payment && ctx.is_income && !is_user_pick)
        return true;
    if (!(0, category_semantics_service_1.is_card_payment_category)(semantic_code))
        return false;
    if (ctx.is_income || ctx.is_paired_card_payment === true)
        return true;
    // D8: the card side usually arrives in 1–3 days. Until then a big payment must not swing Spent.
    if (ctx.now_ms === undefined || ctx.txn_date_ms === undefined)
        return false;
    const age_ms = ctx.now_ms - ctx.txn_date_ms;
    return age_ms >= 0 && age_ms < exports.CARD_SIDE_WAIT_MS;
}
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
        // Same per-split rule for a card payment (`card_payment_is_money_movement`).
        is_transfer: (ctx.is_transfer && (0, category_semantics_service_1.is_transfer_category)(category.semantic_code)) ||
            card_payment_is_money_movement(category.semantic_code, ctx, category.category_source === "user"),
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
 * The card payments whose two sides are both in `txns`: the same matched-pair rule as transfers
 * (opposite direction, same amount, different account, a few days apart; canon A7). Kept apart
 * from `internal_ids` on purpose: a stream with an internal transfer gets hidden as a bill, and a
 * card payment the user tracks as a bill must stay one. Decided regardless of a side's status, so
 * ignoring one side changes nothing. PURE.
 */
function detect_card_payment_pairs_from_txns(txns, catalog) {
    var _a, _b, _c;
    const payments = [];
    const look_alike_credits = [];
    for (const { id, data } of txns) {
        const raw = (_a = data.splits) !== null && _a !== void 0 ? _a : [];
        const is_card_payment = (raw.length ? raw : [{}]).some((s) => (0, category_semantics_service_1.is_card_payment_category)((0, split_category_service_1.resolve_split_category)((0, split_category_edit_service_1.split_category_input_from_raw)(s, data, catalog), catalog).semantic_code));
        const entry = {
            id,
            plaid_id: (_b = data.transactionId) !== null && _b !== void 0 ? _b : null,
            account_id: (_c = data.accountId) !== null && _c !== void 0 ? _c : "",
            amount: raw.reduce((s, sp) => { var _a; return s + Math.abs((_a = sp.amount) !== null && _a !== void 0 ? _a : 0); }, 0),
            date_ms: data.transactionDate.toMillis(),
            direction: data.type === "income" ? "in" : "out",
        };
        if (is_card_payment) {
            payments.push(entry);
        }
        else if (data.type === "income" && can_be_card_side(raw, data, catalog)) {
            look_alike_credits.push(entry);
        }
    }
    if (payments.length === 0)
        return new Set();
    const paired = (0, internal_transfer_service_1.detect_internal_transfers)(payments).internal_ids;
    // D7: some banks label the card side differently (Chase: LOAN_DISBURSEMENTS_*). Debits a real
    // card side didn't take may pair with a same-amount credit on another account.
    const leftover = payments.filter((p) => p.direction === "out" && !paired.has(p.id));
    if (leftover.length && look_alike_credits.length) {
        for (const id of (0, internal_transfer_service_1.detect_internal_transfers)([...leftover, ...look_alike_credits]).internal_ids) {
            paired.add(id);
        }
    }
    return paired;
}
/** Could this credit be a card side labeled differently? Never money that already means something
 *  else (a transfer, income, a linked bill or income line) or a category the user chose. */
function can_be_card_side(raw, data, catalog) {
    return raw.length > 0 && raw.every((s) => {
        if (s.categorySource === "user" || s.budgetAssignmentSource === "manual")
            return false;
        if (s.inflowId || s.outflowId)
            return false; // already tracked as income or a bill
        const code = (0, split_category_service_1.resolve_split_category)((0, split_category_edit_service_1.split_category_input_from_raw)(s, data, catalog), catalog).semantic_code;
        return !(0, category_semantics_service_1.is_transfer_category)(code) && !(0, category_semantics_service_1.is_income_category)(code);
    });
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