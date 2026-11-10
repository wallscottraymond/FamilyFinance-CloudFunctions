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
/** Places kept per budget period (by total, desc). */
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
        var _a, _b;
        const is_purchase = signed > 0;
        if (split.vendor_key) {
            const p = (_a = this.places.get(split.vendor_key)) !== null && _a !== void 0 ? _a : { name: split.place_name || split.vendor_key, count: 0, small: 0, total: 0 };
            p.total += signed;
            if (is_purchase) {
                p.count += 1;
                if (signed < exports.SMALL_PURCHASE_LIMIT)
                    p.small += 1;
            }
            this.places.set(split.vendor_key, p);
        }
        if (split.fee_kind) {
            const f = (_b = this.fees.get(split.fee_kind)) !== null && _b !== void 0 ? _b : { count: 0, total: 0 };
            f.total += signed;
            if (is_purchase)
                f.count += 1;
            this.fees.set(split.fee_kind, f);
        }
    }
    /** Top places by total (positive totals only), ties by count then name. */
    top_places(limit = exports.TOP_PLACES) {
        return [...this.places.entries()]
            .map(([key, p]) => ({ key, name: p.name, count: p.count, small_count: p.small, total: round2(p.total) }))
            .filter((p) => p.total > 0)
            .sort((a, b) => b.total - a.total || b.count - a.count || a.name.localeCompare(b.name))
            .slice(0, limit);
    }
    /** Fee kinds charged in the period (at least one fee), by total desc. */
    fee_list() {
        return [...this.fees.entries()]
            .map(([kind, f]) => ({ kind, count: f.count, total: round2(f.total) }))
            .filter((f) => f.count > 0)
            .sort((a, b) => b.total - a.total || a.kind.localeCompare(b.kind));
    }
}
exports.SpendBreakdownAccumulator = SpendBreakdownAccumulator;
//# sourceMappingURL=spend_breakdown.service.js.map