"use strict";
/**
 * Budget Spend Domain Service
 *
 * Pure, invalidation-based computation of a budget period's spent amount from the
 * transaction splits assigned to it. Spent is RECOMPUTED from the current splits
 * (never incremented), so it can't drift.
 *
 * Rules (from the spend-pipeline design):
 * - A split counts toward a budget period when it is assigned to that budget AND
 *   the transaction date is within the period's range AND it is "countable".
 * - **Countable** excludes: transfers, `ignored` splits, and recurring-mapped
 *   splits (`outflow_id`/`inflow_id` set — the recurring system tracks those).
 * - **`refund` splits stay countable** (you paid → still in `spent`), but their
 *   |amount| ALSO accrues into a parallel `return_amount` = the user's *expected*
 *   returns (Split-Status-Actions). `return_amount` does NOT reduce `spent`; the UI
 *   derives net = `spent − return_amount`. (A real negative Plaid credit is a
 *   separate posted txn that nets `spent` down on its own.)
 * - The FULL split amount counts in EVERY overlapping period (the caller invokes
 *   this once per period; each period is an independent view).
 * - `pending_spent` is the pending-transaction portion of `spent`.
 *
 * NO async, NO IO, NO side effects. Time injected as epoch ms.
 *
 * @module domain/budgets/budget_spend
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.is_income_category = exports.is_transfer_category = void 0;
exports.is_countable = is_countable;
exports.compute_budget_spent = compute_budget_spent;
exports.round_days_to_total = round_days_to_total;
exports.split_spend_status = split_spend_status;
const spend_breakdown_service_1 = require("./spend_breakdown.service");
const DAY_MS = 86400000;
// Plaid category semantics (transfer/income) live in the transactions domain so
// the routing engine and this read-time calc share ONE definition. Re-exported
// here for the existing budget read-path imports.
var category_semantics_service_1 = require("../transactions/category_semantics.service");
Object.defineProperty(exports, "is_transfer_category", { enumerable: true, get: function () { return category_semantics_service_1.is_transfer_category; } });
Object.defineProperty(exports, "is_income_category", { enumerable: true, get: function () { return category_semantics_service_1.is_income_category; } });
/**
 * Whether a split counts toward budget `spent`. Excludes transfers (both the internal
 * matched-pair flag AND the Plaid TRANSFER_* category — so external/unpaired transfers
 * don't leak into Everything-Else), real income, ignored splits, and recurring-linked
 * (bill/income) splits. `refund` and one-off income returns stay countable (the latter
 * reverse spend — see compute_budget_spent). PURE.
 */
function is_countable(split) {
    return (!split.is_transfer &&
        !split.is_transfer_category &&
        !split.is_income_category &&
        split.spend_status !== "ignored" &&
        split.outflow_id === null &&
        split.inflow_id === null &&
        !split.is_recurring_member);
}
/** Round to 2 decimals. PURE. */
function round2(value) {
    return Math.round(value * 100) / 100;
}
/**
 * Recompute a budget period's spent + pending_spent from the splits.
 *
 * @param budget_id - The budget owning this period
 * @param period_start_ms - Period start (inclusive), epoch ms
 * @param period_end_ms - Period end (inclusive), epoch ms
 * @param splits - Candidate splits (any budget; this filters to `budget_id`)
 * @param daily - Optional: also break `spent` into UTC days (Budget daily chart) and the spend
 *   breakdown (purchases per day, places, bank fees — the "Easy to change" tips). Accumulated in
 *   this same loop so none of it can drift from `spent`.
 *
 * PURE FUNCTION.
 */
function compute_budget_spent(budget_id, period_start_ms, period_end_ms, splits, daily) {
    let spent = 0;
    let pending = 0;
    let return_amount = 0;
    const day_count = daily ? Math.max(0, daily.days) : 0;
    const by_day = daily ? new Array(day_count).fill(0) : null;
    const first_day = daily ? Math.floor(daily.start_ms / DAY_MS) : 0;
    const count_by_day = daily ? new Array(day_count).fill(0) : null;
    const breakdown = daily ? new spend_breakdown_service_1.SpendBreakdownAccumulator() : null;
    for (const split of splits) {
        if (split.budget_id !== budget_id) {
            continue;
        }
        if (split.txn_date_ms < period_start_ms || split.txn_date_ms > period_end_ms) {
            continue;
        }
        if (!is_countable(split)) {
            continue;
        }
        // A one-off income return (a credit in an expense category, e.g. an item
        // refund) comes in positive and REVERSES that portion of spend. Everything
        // else adds. Amounts are stored positive; direction comes from `is_income`.
        const magnitude = Math.abs(split.amount);
        const signed = split.is_income ? -magnitude : split.amount;
        spent += signed;
        if (by_day && day_count > 0) {
            // UTC day index; clamp so a split inside the period always lands somewhere.
            const idx = Math.floor(split.txn_date_ms / DAY_MS) - first_day;
            const day = Math.min(day_count - 1, Math.max(0, idx));
            by_day[day] += signed;
            // A purchase = a split that ADDS spend (a credit netting it down isn't one).
            if (count_by_day && signed > 0)
                count_by_day[day] += 1;
        }
        breakdown === null || breakdown === void 0 ? void 0 : breakdown.add(split, signed);
        if (split.is_pending) {
            pending += signed;
        }
        // Refund splits and income returns accrue their magnitude as an expected return.
        if (split.is_income || split.spend_status === "refund") {
            return_amount += magnitude;
        }
    }
    const spent_rounded = round2(spent);
    return Object.assign(Object.assign(Object.assign({ spent: spent_rounded, pending_spent: round2(pending), return_amount: round2(return_amount) }, (by_day ? { daily_spent: round_days_to_total(by_day, spent_rounded) } : {})), (count_by_day ? { daily_count: count_by_day } : {})), (breakdown ? { places: breakdown.top_places(), fees: breakdown.fee_list() } : {}));
}
/**
 * Round each day to cents, then put the rounding remainder on the last non-zero day so the days
 * sum EXACTLY to `total` (the already-rounded `spent`). PURE.
 */
function round_days_to_total(raw, total) {
    const days = raw.map((v) => round2(v) + 0); // `+ 0` turns -0 into 0
    if (days.length === 0)
        return days;
    const cents_off = Math.round(total * 100) - days.reduce((sum, v) => sum + Math.round(v * 100), 0);
    if (cents_off !== 0) {
        let last = days.length - 1;
        for (let i = days.length - 1; i >= 0; i--) {
            if (days[i] !== 0) {
                last = i;
                break;
            }
        }
        days[last] = (Math.round(days[last] * 100) + cents_off) / 100 + 0;
    }
    return days;
}
/**
 * A stored split's spend status — THE one reading (the period page, stored spend and every other
 * reader): explicit `spendStatus` wins, else the legacy `isIgnored` / `isRefund` booleans, else
 * "counted". PURE.
 */
function split_spend_status(split) {
    const status = split.spendStatus;
    if (status === "counted" || status === "ignored" || status === "refund")
        return status;
    return split.isIgnored === true ? "ignored" : split.isRefund === true ? "refund" : "counted";
}
//# sourceMappingURL=budget_spend.service.js.map