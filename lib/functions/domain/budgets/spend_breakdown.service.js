"use strict";
/**
 * Spend Breakdown Domain Service
 *
 * The pieces behind the Budgets page "Easy to change" tips, built from the SAME counted splits as a
 * budget period's `spent` (accumulated inside `compute_budget_spent`'s loop, so they can't drift):
 * where the money went (places) and what bank fees it held (fees). No reads of its own: the place
 * and fee fields ride on each split from the transactions derive already loaded.
 *
 * PURE: no IO.
 *
 * @module domain/budgets/spend_breakdown
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpendBreakdownAccumulator = exports.TOP_PLACES = exports.SMALL_PURCHASE_LIMIT = void 0;
exports.is_bank_fee_code = is_bank_fee_code;
exports.fee_kind_of = fee_kind_of;
exports.split_fee_kind = split_fee_kind;
/** A purchase under this (dollars) counts as a small one. */
exports.SMALL_PURCHASE_LIMIT = 25;
/** Places kept per budget period: the top this-many by total UNION the top this-many by purchase
 *  count (so a frequent small habit isn't cut by a few big buys) — up to twice this many. */
exports.TOP_PLACES = 8;
/** Whether a Plaid code is a bank fee (the BANK_FEES primary). PURE. */
function is_bank_fee_code(code) {
    return typeof code === "string" && code.startsWith("BANK_FEES");
}
/** A `BANK_FEES_*` code → its kind; null for any other code. PURE. */
function fee_kind_of(code) {
    if (!is_bank_fee_code(code))
        return null;
    const c = code;
    if (c === "BANK_FEES_ATM_FEES")
        return "atm";
    if (c.includes("LATE"))
        return "late";
    if (c === "BANK_FEES_OVERDRAFT_FEES" || c === "BANK_FEES_INSUFFICIENT_FUNDS")
        return "overdraft";
    if (c === "BANK_FEES_FOREIGN_TRANSACTION_FEES")
        return "foreign";
    if (c === "BANK_FEES_INTEREST_CHARGE")
        return "interest"; // card interest
    return "other";
}
/**
 * A split's fee kind from its resolved category. A user pick of the Bank Fees category without a
 * specific detail carries a REPRESENTATIVE code (any fee), so its kind comes from Plaid's own code
 * when that is a fee too, else "other". PURE.
 */
function split_fee_kind(resolved, plaid_detailed) {
    var _a;
    if (!is_bank_fee_code(resolved.semantic_code))
        return null;
    if (resolved.category_source === "user" && !resolved.second_category_id) {
        return (_a = fee_kind_of(plaid_detailed)) !== null && _a !== void 0 ? _a : "other";
    }
    return fee_kind_of(resolved.semantic_code);
}
/** The most frequent key (ties → alphabetical, so the result is deterministic); "" if none. */
function most_common(counts) {
    let best = "";
    let best_n = 0;
    for (const [k, n] of counts) {
        if (n > best_n || (n === best_n && k < best)) {
            best = k;
            best_n = n;
        }
    }
    return best;
}
function round2(value) {
    return Math.round(value * 100) / 100 + 0;
}
/** Accumulates places + fees over a period's counted splits (one `add` per counted split). */
class SpendBreakdownAccumulator {
    constructor() {
        this.places = new Map();
        this.fees = new Map();
    }
    /** `signed` = the split's contribution to `spent` (negative for a credit that nets it down). */
    add(split, signed) {
        var _a, _b, _c;
        const is_purchase = signed > 0;
        if (split.vendor_key) {
            const p = (_a = this.places.get(split.vendor_key)) !== null && _a !== void 0 ? _a : { name: split.place_name || split.vendor_key, count: 0, small: 0, total: 0, codes: new Map() };
            p.total += signed;
            if (is_purchase) {
                p.count += 1;
                if (signed < exports.SMALL_PURCHASE_LIMIT)
                    p.small += 1;
                if (split.category_code) {
                    p.codes.set(split.category_code, ((_b = p.codes.get(split.category_code)) !== null && _b !== void 0 ? _b : 0) + 1);
                }
            }
            this.places.set(split.vendor_key, p);
        }
        if (split.fee_kind) {
            const f = (_c = this.fees.get(split.fee_kind)) !== null && _c !== void 0 ? _c : { count: 0, total: 0 };
            f.total += signed;
            if (is_purchase)
                f.count += 1;
            this.fees.set(split.fee_kind, f);
        }
    }
    /**
     * The places to show (positive totals only): the top `limit` by total UNION the top `limit` by
     * purchase count, deduped, sorted by total desc (ties by count, then name) — up to 2 × `limit`.
     */
    top_places(limit = exports.TOP_PLACES) {
        const all = [...this.places.entries()]
            .map(([key, p]) => ({
            key, name: p.name, count: p.count, small_count: p.small, total: round2(p.total),
            code: most_common(p.codes),
        }))
            .filter((p) => p.total > 0);
        const by_total = (a, b) => b.total - a.total || b.count - a.count || a.name.localeCompare(b.name);
        const by_count = (a, b) => b.count - a.count || b.total - a.total || a.name.localeCompare(b.name);
        const keep = new Set([
            ...[...all].sort(by_total).slice(0, limit).map((p) => p.key),
            ...[...all].sort(by_count).slice(0, limit).map((p) => p.key),
        ]);
        return all.filter((p) => keep.has(p.key)).sort(by_total);
    }
    /** Fee kinds charged in the period (at least one fee, net total > 0), by total desc. */
    fee_list() {
        return [...this.fees.entries()]
            .map(([kind, f]) => ({ kind, count: f.count, total: round2(f.total) }))
            .filter((f) => f.count > 0 && f.total > 0)
            .sort((a, b) => b.total - a.total || a.kind.localeCompare(b.kind));
    }
}
exports.SpendBreakdownAccumulator = SpendBreakdownAccumulator;
//# sourceMappingURL=spend_breakdown.service.js.map