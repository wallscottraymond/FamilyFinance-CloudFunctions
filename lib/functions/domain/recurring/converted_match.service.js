"use strict";
/**
 * D1 matching of payments to converted bills (Convert-To-Recurring Phase 2) — PURE.
 *
 * A converted record is a v2 + manual record with a stored vendor key on a Plaid account
 * (`is_converted_candidate`). A payment links to it when it is the same direction + account +
 * vendor, whatever its amount (D1 / D39) — a deterministic key, not the fuzzy scorer. The key maps
 * to a LIST of bills (D44: two bills from one vendor on one account are allowed):
 *
 *   - one eligible bill  → it (final, no fuzzy fallthrough);
 *   - two or more        → the fuzzy scorer restricted to exactly those bills; if it decides, that
 *                          one, else the closest expected amount, then the smallest id — a pure
 *                          function of stored data (never "closest to today").
 *
 * What D1 links (the narrow rule the review settled on):
 *   - only SINGLE-split transactions (a multi-split payment is the user's own breakdown; the source
 *     split of a convert is pinned directly and a pin always wins);
 *   - only payments on or after the record's D1 floor — the day it was created by the new path
 *     (`d1_from_ms`), never before its first date minus the early-payment pad. The payments a
 *     convert linked in the past (D2 / D46: one per occurrence) are listed on the record
 *     (`retro_plaid_ids`) and stay linked; the rest of the vendor's past payments stay in budgets.
 *
 * @module domain/recurring/converted_match
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.build_converted_index = build_converted_index;
exports.d1_allows = d1_allows;
exports.eligible_bills = eligible_bills;
exports.pick_converted_bill = pick_converted_bill;
const convert_recurring_service_1 = require("./convert_recurring.service");
/** Build the index from the user's loaded bills + income. Active, shown, un-merged records only. PURE. */
function build_converted_index(records) {
    var _a, _b, _c, _d;
    const by_key = new Map();
    const by_id = new Map();
    const ids = new Set();
    for (const r of records) {
        if (!r.is_active || r.is_hidden || r.merged_into_id)
            continue;
        if (!(0, convert_recurring_service_1.is_converted_candidate)(r))
            continue;
        const key = (0, convert_recurring_service_1.converted_key)(r.direction, r.account_id, r.vendor_key);
        const day = r.converted_at_ms != null ? (0, convert_recurring_service_1.utc_day_start)(r.converted_at_ms) : Number.NEGATIVE_INFINITY;
        const floor = Math.max(r.first_date_ms - convert_recurring_service_1.D1_EARLY_PAD_MS, day);
        const bill = {
            id: r.id,
            created_from_ms: (_a = r.converted_at_ms) !== null && _a !== void 0 ? _a : Number.POSITIVE_INFINITY,
            // …and no older than two weeks before the convert day (a pending payment that posted, an early one).
            first_floor_ms: Math.max(r.first_date_ms - convert_recurring_service_1.D1_EARLY_PAD_MS, (r.converted_at_ms != null ? (0, convert_recurring_service_1.utc_day_start)(r.converted_at_ms) : 0) - 14 * 86400000),
            amount: Math.abs((_b = r.expected_amount_override) !== null && _b !== void 0 ? _b : r.average_amount),
            d1_from_ms: floor,
            retro_plaid_ids: new Set((_c = r.retro_txn_ids) !== null && _c !== void 0 ? _c : []),
        };
        const list = (_d = by_key.get(key)) !== null && _d !== void 0 ? _d : [];
        list.push(bill);
        by_key.set(key, list);
        by_id.set(r.id, bill);
        ids.add(r.id);
    }
    for (const list of by_key.values())
        list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { by_key, by_id, ids };
}
/** May D1 link this payment to this bill (date floor, or a payment a convert linked)? PURE. */
function d1_allows(bill, payment) {
    if (payment.date_ms >= bill.d1_from_ms)
        return true;
    if (payment.plaid_id && bill.retro_plaid_ids.has(payment.plaid_id))
        return true;
    // A payment that ARRIVED after the bill existed (a pending one that posted, history that synced
    // late) belongs to it even when dated before the convert day — never older than its first date.
    return payment.created_ms != null && payment.created_ms >= bill.created_from_ms && payment.date_ms >= bill.first_floor_ms;
}
/**
 * The bills a payment is eligible for: a payment a convert LINKED (its retro list) belongs to that
 * bill alone — another bill of the same key never competes for it (so the trigger path and the
 * batch path, whatever candidates each loaded, give the same answer).
 */
function eligible_bills(bills, payment) {
    if (payment.plaid_id) {
        const owners = bills.filter((b) => b.retro_plaid_ids.has(payment.plaid_id));
        if (owners.length > 0)
            return owners;
    }
    return bills.filter((b) => d1_allows(b, payment));
}
/**
 * Choose among the bills D1 allows. `scorer_pick` is the fuzzy scorer's decision restricted to
 * exactly these bills (null when it didn't decide). PURE and deterministic.
 */
function pick_converted_bill(eligible, split_amount, scorer_pick) {
    if (eligible.length === 0)
        return null;
    if (eligible.length === 1)
        return eligible[0].id;
    if (scorer_pick && eligible.some((b) => b.id === scorer_pick))
        return scorer_pick;
    const amount = Math.abs(split_amount);
    let best = eligible[0];
    for (const b of eligible) {
        const d = Math.abs(b.amount - amount);
        const bd = Math.abs(best.amount - amount);
        if (d < bd || (d === bd && b.id < best.id))
            best = b;
    }
    return best.id;
}
//# sourceMappingURL=converted_match.service.js.map