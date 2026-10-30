"use strict";
/**
 * Convert Resolver — READ-ONLY facts for converting a transaction into a bill / income, and for
 * previewing it (Convert-To-Recurring Phase 2).
 *
 * Authorization comes FIRST: the transaction's owner must be the caller (D24 — a group member can't
 * convert the other person's transaction, and nothing else is read for them, so nothing leaks).
 * Then it loads exactly what the pure rules need: the user's shown bills / income (what already
 * claims the payment, which Plaid payments belong to a live stream), the account's sharing
 * placement (D45) and the vendor's payments on that account (one query on the existing
 * `(userId, isActive, vendorKey, transactionDate)` index; the account is filtered in memory).
 *
 * @module resolvers/recurring/convert
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.txn_facts = txn_facts;
exports.resolve_convert_facts = resolve_convert_facts;
const transaction_repo_1 = require("../../repositories/transaction.repo");
const outflow_repo_1 = require("../../repositories/outflow.repo");
const inflow_repo_1 = require("../../repositories/inflow.repo");
const account_repo_1 = require("../../repositories/account.repo");
const vendor_key_service_1 = require("../../domain/transactions/vendor_key.service");
const convert_plan_service_1 = require("../../domain/recurring/convert_plan.service");
const stream_membership_1 = require("../../domain/recurring/stream_membership");
const recurring_suppression_service_1 = require("../../domain/recurring/recurring_suppression.service");
/** The raw transaction doc → the facts the rules read. */
function txn_facts(doc_id, d, in_shown_stream) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    const splits = (_a = d.splits) !== null && _a !== void 0 ? _a : [];
    const source = (_b = [d.merchantName, d.name, d.description]
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .find((v) => v.length > 0)) !== null && _b !== void 0 ? _b : null;
    const stored_key = typeof d.vendorKey === "string" && d.vendorKey.length > 0 ? d.vendorKey : null;
    const first = (_c = splits[0]) !== null && _c !== void 0 ? _c : {};
    return {
        doc_id,
        plaid_id: (_d = d.transactionId) !== null && _d !== void 0 ? _d : null,
        type: (_e = d.type) !== null && _e !== void 0 ? _e : null,
        account_id: (_f = d.accountId) !== null && _f !== void 0 ? _f : "",
        date_ms: (_j = (_h = (_g = d.transactionDate) === null || _g === void 0 ? void 0 : _g.toMillis) === null || _h === void 0 ? void 0 : _h.call(_g)) !== null && _j !== void 0 ? _j : 0,
        amount: typeof d.amount === "number" ? d.amount : splits.reduce((s, x) => s + (Number(x.amount) || 0), 0),
        is_pending: d.isPending === true,
        is_active: d.isActive !== false,
        transfer_role: (_k = d.transferRole) !== null && _k !== void 0 ? _k : null,
        plaid_primary_category: (_m = (_l = first.plaidPrimaryCategory) !== null && _l !== void 0 ? _l : d.plaidPrimaryCategory) !== null && _m !== void 0 ? _m : null,
        plaid_detailed_category: (_p = (_o = first.plaidDetailedCategory) !== null && _o !== void 0 ? _o : d.plaidDetailedCategory) !== null && _p !== void 0 ? _p : null,
        vendor_source: source,
        vendor_key: stored_key !== null && stored_key !== void 0 ? stored_key : (0, vendor_key_service_1.vendor_key)({
            merchant_name: d.merchantName,
            name: d.name,
            description: d.description,
        }),
        splits: splits.map((s) => {
            var _a, _b, _c;
            return ({
                split_id: String((_a = s.splitId) !== null && _a !== void 0 ? _a : ""),
                outflow_id: (_b = s.outflowId) !== null && _b !== void 0 ? _b : null,
                inflow_id: (_c = s.inflowId) !== null && _c !== void 0 ? _c : null,
            });
        }),
        in_shown_stream,
    };
}
/** A record's display name (the user's, else the merchant / payer, else its description). */
function record_name(r) {
    return r.user_custom_name || r.merchant_name || r.payer_name || r.description || "a bill";
}
async function resolve_convert_facts(ctx, user_id, transaction_id, now_ms, 
/** The split being converted (absent = the whole transaction). */
split_id) {
    var _a, _b, _c, _d, _e, _f;
    const txn = await transaction_repo_1.transaction_repo.get_raw_by_id(ctx, transaction_id);
    if (!txn)
        return { ok: false, reason: "not_found" };
    const owner = (_a = txn.data.ownerId) !== null && _a !== void 0 ? _a : txn.data.userId;
    if (owner !== user_id)
        return { ok: false, reason: "permission_denied" };
    const [outflows, inflows, accounts] = await Promise.all([
        outflow_repo_1.outflow_repo.get_by_user_id(ctx, user_id),
        inflow_repo_1.inflow_repo.get_by_user_id(ctx, user_id),
        account_repo_1.account_repo.get_by_user_id(ctx, user_id),
    ]);
    const shown = (r) => r.is_active && !r.is_hidden && !r.merged_into_id;
    const shown_out = outflows.filter(shown);
    const shown_in = inflows.filter(shown);
    const stream_ids = new Set([...shown_out, ...shown_in].flatMap((r) => { var _a; return (_a = r.transaction_ids) !== null && _a !== void 0 ? _a : []; }));
    const base = txn_facts(txn.id, txn.data, false);
    const direction = (0, convert_plan_service_1.direction_of)(base.type);
    // D41: stopped records (inactive, not merged) of this vendor on this account — read only for a
    // transaction that can convert (one small owner-scoped query). Their Plaid payments are history of
    // THEIR bill: the retro-link never takes them.
    let old_bills = [];
    if (direction && base.vendor_key && base.account_id) {
        const inactive = direction === "inflow"
            ? await inflow_repo_1.inflow_repo.get_inactive_by_user_id(ctx, user_id)
            : await outflow_repo_1.outflow_repo.get_inactive_by_user_id(ctx, user_id);
        const matching = inactive.filter((r) => !r.merged_into_id && r.account_id === base.account_id &&
            (0, vendor_key_service_1.vendor_key)({
                merchant_name: "merchant_name" in r ? r.merchant_name : r.payer_name,
                name: r.description,
            }) === base.vendor_key);
        old_bills = matching.map((r) => {
            var _a, _b, _c, _d;
            return ({
                id: r.id, removal_intervals: r.removal_intervals, user_custom_name: r.user_custom_name,
                expected_amount_override: r.expected_amount_override, user_frequency: (_a = r.user_frequency) !== null && _a !== void 0 ? _a : null,
                last_payment_ms: (_d = (_c = (_b = r.last_date) === null || _b === void 0 ? void 0 : _b.toMillis) === null || _c === void 0 ? void 0 : _c.call(_b)) !== null && _d !== void 0 ? _d : null,
                merged_into_id: r.merged_into_id, account_id: r.account_id, is_active: r.is_active,
            });
        });
        for (const r of matching)
            for (const t of (_b = r.transaction_ids) !== null && _b !== void 0 ? _b : [])
                stream_ids.add(t);
    }
    const own = txn_facts(txn.id, txn.data, !!base.plaid_id && stream_ids.has(base.plaid_id));
    // What already claims the source: a split link to a shown record, or its Plaid stream (a split
    // taken off the stream by a detach / budget pin doesn't count).
    const records = direction === "inflow" ? shown_in : shown_out;
    const kind = direction === "inflow" ? "inflow" : "outflow";
    const raw_splits = (_c = txn.data.splits) !== null && _c !== void 0 ? _c : [];
    // Only the split(s) being converted can be claimed (a sibling split already in a bill doesn't block B).
    const wanted_splits = split_id ? [split_id] : raw_splits.map((x) => { var _a; return String((_a = x.splitId) !== null && _a !== void 0 ? _a : ""); });
    const claim_splits = raw_splits.filter((x) => { var _a; return wanted_splits.includes(String((_a = x.splitId) !== null && _a !== void 0 ? _a : "")); });
    let claimed_by = null;
    for (const r of records) {
        // A bill the user removed / ended right now isn't a live bill: its payment converts. A PAUSED bill is
        // still live ("Part of <bill>"), so converting one of its payments is refused.
        if ((0, recurring_suppression_service_1.is_removed_now)(r.removal_intervals, now_ms))
            continue;
        const in_stream = !!base.plaid_id && ((_d = r.transaction_ids) !== null && _d !== void 0 ? _d : []).includes(base.plaid_id);
        if ((0, stream_membership_1.splits_paying_recurring)(claim_splits, kind, r.id, in_stream).length > 0) {
            claimed_by = { id: r.id, name: record_name(r) };
            break;
        }
    }
    // A record already converted from THIS transaction (double tap / timed-out convert): resume it.
    // …for THIS split: a second split of the same transaction converts on its own (E).
    const prior = [...outflows, ...inflows].find((r) => {
        var _a, _b;
        return r.converted_from_txn_id === txn.id && r.is_active &&
            (((_a = r.converted_from_split_ids) !== null && _a !== void 0 ? _a : []).length === 0 || ((_b = r.converted_from_split_ids) !== null && _b !== void 0 ? _b : []).some((x) => wanted_splits.includes(x)));
    });
    const existing_conversion = prior
        ? {
            id: prior.id,
            name: record_name(prior),
            live: shown(prior) && !prior.removed_by_user,
            retro_done: ((_e = prior.retro_linked_at_ms) !== null && _e !== void 0 ? _e : null) !== null,
        }
        : null;
    if (existing_conversion)
        claimed_by = null; // its own claim is not "another bill"
    const acct = accounts.find((a) => a.id === own.account_id || a.account_id === own.account_id);
    const placement = (acct === null || acct === void 0 ? void 0 : acct.placement)
        ? { group_id: acct.placement.group_id, shared_from_ms: (_f = acct.placement.shared_from_ms) !== null && _f !== void 0 ? _f : null }
        : null;
    const facts = {
        user_id, txn: own, vendor_txns: [], claimed_by, placement, now_ms,
    };
    // The vendor's other payments (only worth reading for a transaction that can convert).
    if (own.vendor_key && own.account_id && !existing_conversion) {
        let rows = await transaction_repo_1.transaction_repo.get_by_vendor_key(ctx, user_id, own.vendor_key, (0, convert_plan_service_1.retro_floor_ms)(facts));
        // Transactions written before `vendorKey` was stored aren't found by the key: when the source
        // itself has none, scan the account's window and compute the key exactly as the engine does.
        if (!(typeof txn.data.vendorKey === "string" && txn.data.vendorKey)) {
            const have = new Set(rows.map((x) => x.id));
            const window = await transaction_repo_1.transaction_repo.get_account_window(ctx, user_id, own.account_id, (0, convert_plan_service_1.retro_floor_ms)(facts));
            rows = [...rows, ...window.filter((w) => !have.has(w.id) && !w.data.vendorKey && txn_facts(w.id, w.data, false).vendor_key === own.vendor_key)];
        }
        // A link to a record that no longer EXISTS (hard-deleted — the D47 recovery — before its
        // re-assign has run) isn't a link: the payment is the vendor's like any other. An inactive record
        // (Plaid-stale, a D41 old bill) still exists and keeps its history. Only ids outside the active
        // set are looked up (one batched read, usually none).
        const active_ids = new Set([...outflows, ...inflows].map((r) => r.id));
        const all = rows.map((r) => txn_facts(r.id, r.data, false));
        const unknown = (k) => [...new Set(all.flatMap((f) => f.splits.map((x) => x[k]).filter((v) => !!v && !active_ids.has(v))))];
        const [out_found, in_found] = await Promise.all([
            unknown("outflow_id").length ? outflow_repo_1.outflow_repo.get_raw_by_ids(ctx, unknown("outflow_id")) : new Map(),
            unknown("inflow_id").length ? inflow_repo_1.inflow_repo.get_raw_by_ids(ctx, unknown("inflow_id")) : new Map(),
        ]);
        const exists = (id, found) => active_ids.has(id) || found.has(id);
        facts.vendor_txns = all.map((f) => {
            f.splits = f.splits.map((x) => (Object.assign(Object.assign({}, x), { outflow_id: x.outflow_id && exists(x.outflow_id, out_found) ? x.outflow_id : null, inflow_id: x.inflow_id && exists(x.inflow_id, in_found) ? x.inflow_id : null })));
            return Object.assign(Object.assign({}, f), { in_shown_stream: !!f.plaid_id && stream_ids.has(f.plaid_id) });
        });
    }
    return { ok: true, facts, existing_conversion, old_bills };
}
//# sourceMappingURL=convert.resolver.js.map