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
exports.load_recurring_candidates = load_recurring_candidates;
exports.load_recurring_candidates_scoped = load_recurring_candidates_scoped;
exports.resolve_recurring_matches = resolve_recurring_matches;
const firestore_1 = require("firebase-admin/firestore");
const outflow_period_repo_1 = require("../../repositories/outflow_period.repo");
const inflow_period_repo_1 = require("../../repositories/inflow_period.repo");
const match_recurring_service_1 = require("../../domain/transactions/match_recurring.service");
const converted_match_service_1 = require("../../domain/recurring/converted_match.service");
const convert_recurring_service_1 = require("../../domain/recurring/convert_recurring.service");
const WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // ±90 days candidate window
function ms(value) {
    return value instanceof firestore_1.Timestamp ? value.toMillis() : null;
}
/** Map a raw outflow_period doc → bill candidate (pure). */
function to_outflow_candidate(id, d) {
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
}
/** Map a raw inflow_period doc → income candidate (pure). */
function to_inflow_candidate(id, d) {
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
}
/**
 * Load ALL bill + income candidate periods due in [start_ms, end_ms] ONCE (for the batch path).
 * These are the same two queries the per-transaction path runs — executed a single time.
 */
async function load_recurring_candidates(ctx, user_id, start_ms, end_ms) {
    const [outflow_docs, inflow_docs] = await Promise.all([
        outflow_period_repo_1.outflow_period_repo.get_in_due_window(ctx, user_id, start_ms, end_ms),
        inflow_period_repo_1.inflow_period_repo.get_in_due_window(ctx, user_id, start_ms, end_ms),
    ]);
    return {
        outflow_candidates: outflow_docs.map(({ id, data }) => to_outflow_candidate(id, data)),
        inflow_candidates: inflow_docs.map(({ id, data }) => to_inflow_candidate(id, data)),
        window_start_ms: start_ms,
        window_end_ms: end_ms,
    };
}
/**
 * Load candidate periods SCOPED to a known set of outflow/inflow ids (read-cost #1). Same shape
 * as `load_recurring_candidates`, but instead of scanning ALL of a user's due periods it reads
 * only the given streams' periods in [start_ms, end_ms]. Correct for the recurring-reconcile
 * assign path: its txns ARE these streams' membership, so single-split txns resolve via the
 * authoritative stream map and multi-split scoring only ever needs its own stream's occurrences.
 * `window_start/end` stay the true batch span so `candidates_for_txn`'s coverage check passes
 * (never falling back to a per-txn full scan).
 */
async function load_recurring_candidates_scoped(ctx, outflow_ids, inflow_ids, start_ms, end_ms) {
    const [outflow_docs, inflow_docs] = await Promise.all([
        outflow_period_repo_1.outflow_period_repo.get_in_due_window_for_ids(ctx, outflow_ids, start_ms, end_ms),
        inflow_period_repo_1.inflow_period_repo.get_in_due_window_for_ids(ctx, inflow_ids, start_ms, end_ms),
    ]);
    return {
        outflow_candidates: outflow_docs.map(({ id, data }) => to_outflow_candidate(id, data)),
        inflow_candidates: inflow_docs.map(({ id, data }) => to_inflow_candidate(id, data)),
        window_start_ms: start_ms,
        window_end_ms: end_ms,
    };
}
/** Outflow (bill) period candidates around the transaction date (per-transaction fallback). */
async function load_outflow_candidates(ctx, user_id, txn_date_ms) {
    const docs = await outflow_period_repo_1.outflow_period_repo.get_in_due_window(ctx, user_id, txn_date_ms - WINDOW_MS, txn_date_ms + WINDOW_MS);
    return docs.map(({ id, data }) => to_outflow_candidate(id, data));
}
/** Inflow (income) period candidates around the transaction date (per-transaction fallback). */
async function load_inflow_candidates(ctx, user_id, txn_date_ms) {
    const docs = await inflow_period_repo_1.inflow_period_repo.get_in_due_window(ctx, user_id, txn_date_ms - WINDOW_MS, txn_date_ms + WINDOW_MS);
    return docs.map(({ id, data }) => to_inflow_candidate(id, data));
}
/**
 * Candidates for a transaction: reuse the batch-preloaded set (filtered to the txn's ±90d
 * window — identical to a fresh query) when it fully covers that window; otherwise fall back
 * to a per-transaction query (e.g. a historical date outside the preloaded window).
 */
async function candidates_for_txn(ctx, user_id, is_expense, txn_date_ms, preloaded) {
    const lo = txn_date_ms - WINDOW_MS;
    const hi = txn_date_ms + WINDOW_MS;
    if (preloaded && lo >= preloaded.window_start_ms && hi <= preloaded.window_end_ms) {
        const all = is_expense ? preloaded.outflow_candidates : preloaded.inflow_candidates;
        return all.filter((c) => c.due_date_ms != null && c.due_date_ms >= lo && c.due_date_ms <= hi);
    }
    return is_expense
        ? load_outflow_candidates(ctx, user_id, txn_date_ms)
        : load_inflow_candidates(ctx, user_id, txn_date_ms);
}
/**
 * Resolve the recurring (bill/income) matches for a transaction's splits.
 *
 * @param txn_type - Transaction type: `expense` → outflows, `income` → inflows.
 */
async function resolve_recurring_matches(ctx, user_id, txn_type, txn_merchant_name, txn_date_ms, splits, opts = {}) {
    var _a, _b, _c;
    const out = {};
    for (const s of splits) {
        out[s.split_id] = { outflow_id: null, inflow_id: null };
    }
    const is_income = txn_type === "income";
    const is_expense = txn_type === "expense";
    if (!is_income && !is_expense) {
        return out; // transfers match nothing
    }
    // D1 (Convert-To-Recurring Phase 2): the payment's direction + account + vendor key names the
    // user's converted bill(s). A single-split payment dated on/after the bill's D1 floor (or one
    // its convert linked) links to it, ANY amount. Two or more bills of one key: the fuzzy scorer
    // restricted to exactly those, else the closest amount, else the smallest id — deterministic.
    const converted = opts.converted_index;
    const dir = is_expense ? "outflow" : "inflow";
    let d1_pick = null;
    if (converted && converted.ids.size > 0 && opts.txn_account_id && opts.txn_vendor_key && splits.length === 1) {
        const key_bills = converted.by_key.get((0, convert_recurring_service_1.converted_key)(dir, opts.txn_account_id, opts.txn_vendor_key));
        const eligible = (0, converted_match_service_1.eligible_bills)(key_bills !== null && key_bills !== void 0 ? key_bills : [], { date_ms: txn_date_ms, plaid_id: (_a = opts.txn_plaid_id) !== null && _a !== void 0 ? _a : null, created_ms: opts.txn_created_ms });
        if (eligible.length > 0) {
            let scorer_pick = null;
            if (eligible.length > 1) {
                const ids = new Set(eligible.map((b) => b.id));
                const restricted = (await candidates_for_txn(ctx, user_id, is_expense, txn_date_ms, opts.preloaded_candidates))
                    .filter((c) => ids.has(c.recurring_id));
                scorer_pick = (0, match_recurring_service_1.match_recurring)({ merchant_name: txn_merchant_name, amount: Math.abs(splits[0].amount), date_ms: txn_date_ms }, restricted).recurring_id;
            }
            d1_pick = (0, converted_match_service_1.pick_converted_bill)(eligible, splits[0].amount, scorer_pick);
        }
    }
    // D42: a payment of a stream a converted bill absorbed links to it (even if its vendor key differs)
    // — under the same floors and single-split rule as a key hit.
    if (!d1_pick && converted && opts.txn_plaid_id && splits.length === 1) {
        const bill_id = (_b = opts.absorbed_tx_to_id) === null || _b === void 0 ? void 0 : _b.get(opts.txn_plaid_id);
        const bill = bill_id ? converted.by_id.get(bill_id) : undefined;
        if (bill && (0, converted_match_service_1.d1_allows)(bill, { date_ms: txn_date_ms, plaid_id: opts.txn_plaid_id, created_ms: opts.txn_created_ms }))
            d1_pick = bill.id;
    }
    // 0. AUTHORITATIVE deterministic link: if this transaction is a member of a recurring
    //    stream (its Plaid id is in the def's `transactionIds`), link EVERY split to it —
    //    exactly how the period page treats a stream member (the whole transaction is the
    //    payment, no split counts in a budget). Plaid's own stream membership beats the fuzzy
    //    merchant/amount scorer, which misses empty-merchant bills / stale periods (the S1 root
    //    cause). The engine then takes individual splits OFF per split — a budget pin or a
    //    "remove from bill" detach (domain/recurring/stream_membership, canon A4) — as the page
    //    does. No stream match → fuzzy fallback below.
    const stream_map = is_expense ? opts.outflow_tx_to_id : opts.inflow_tx_to_id;
    if (opts.txn_plaid_id && stream_map) {
        const recurring_id = stream_map.get(opts.txn_plaid_id);
        if (recurring_id) {
            for (const s of splits) {
                out[s.split_id] = is_expense
                    ? { outflow_id: recurring_id, inflow_id: null }
                    : { outflow_id: null, inflow_id: recurring_id };
                if (d1_pick && d1_pick !== recurring_id) {
                    out[s.split_id].d1_alt_id = d1_pick;
                    out[s.split_id].d1_alt_kind = dir;
                }
            }
            return out;
        }
    }
    // D1: a converted bill of this payment's key (after stream membership, before the hold-out).
    if (d1_pick) {
        out[splits[0].split_id] = is_expense
            ? { outflow_id: d1_pick, inflow_id: null }
            : { outflow_id: null, inflow_id: d1_pick };
        return out;
    }
    // Held out of fuzzy matching (Convert-To-Recurring X3): a payment of a stream Plaid is unsure of
    // (or the user said isn't a bill) is never linked to an old bill by a merchant / amount guess —
    // that would make the old bill read paid and drop the payment from budgets (a D13 leak).
    if (opts.txn_plaid_id && ((_c = opts.fuzzy_excluded_plaid_ids) === null || _c === void 0 ? void 0 : _c.has(opts.txn_plaid_id))) {
        return out;
    }
    // Converted bills are matched by D1 only: the fuzzy scorer never links to them (an unlinked
    // payment of theirs — a multi-split one, one before their floor — stays a normal transaction).
    const converted_ids = converted === null || converted === void 0 ? void 0 : converted.ids;
    const all_candidates = (await candidates_for_txn(ctx, user_id, is_expense, txn_date_ms, opts.preloaded_candidates)).filter((c) => !converted_ids || converted_ids.size === 0 || !converted_ids.has(c.recurring_id));
    // F13: a v2 bill / income is fuzzy-matched only by payments from its own account (a payment from
    // another account — the bill moved — is not auto-linked in Phase 1). Old records: unchanged.
    const v2_accounts = opts.v2_account_by_recurring_id;
    const candidates = v2_accounts && v2_accounts.size > 0
        ? all_candidates.filter((c) => {
            var _a;
            const account = v2_accounts.get(c.recurring_id);
            return account === undefined || account === ((_a = opts.txn_account_id) !== null && _a !== void 0 ? _a : null);
        })
        : all_candidates;
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