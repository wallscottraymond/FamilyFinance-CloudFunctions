"use strict";
/**
 * Budget View Derivation Domain Service
 *
 * Derive-On-Read Period Architecture — Phase 1.
 *
 * PURE, deterministic derivation of a budget's weekly / bi-weekly VIEW from its
 * single materialized MONTHLY home. Instead of storing a budget_period per
 * cadence, we compute the non-monthly views on read:
 *
 *   - `spent` for a view bucket = the SAME windowed sum the stored path uses
 *     (`compute_budget_spent` over the splits whose date falls in the bucket).
 *     A split's budget assignment is cadence-INDEPENDENT — it belongs to the
 *     budget in every view, only the date window changes — so the caller passes
 *     the splits resolved against the budget's canonical (monthly/legacy)
 *     assignment.
 *   - `allocated` / `effective` (the limit) for a view bucket = the overlapping
 *     monthly period(s)' amount PRO-RATED by overlapping days (daily-rate ×
 *     days-overlapped), summed. `effective` folds in the monthly rollover chain,
 *     so `remaining = pro-rated monthly effective − spent` (locked decision:
 *     rollover lives on the monthly chain; non-monthly views pro-rate it).
 *
 * This function stores nothing and reads nothing. All IO (fetch the monthly
 * periods, the view's source-period buckets, and the splits) happens in the
 * resolver; time/dates arrive as epoch ms.
 *
 * @module domain/budgets/budget_view
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_budget_view_periods = derive_budget_view_periods;
const budget_spend_service_1 = require("./budget_spend.service");
/** UTC day index (days since epoch) for a timestamp. PURE. */
function utc_day_index(ms) {
    const d = new Date(ms);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
}
/** Inclusive UTC-normalized day count for a range. PURE. */
function days_inclusive(start_ms, end_ms) {
    return utc_day_index(end_ms) - utc_day_index(start_ms) + 1;
}
/**
 * Inclusive UTC-day overlap (in days) between two ranges. 0 if disjoint. PURE.
 */
function overlap_days(a_start_ms, a_end_ms, b_start_ms, b_end_ms) {
    const start = Math.max(utc_day_index(a_start_ms), utc_day_index(b_start_ms));
    const end = Math.min(utc_day_index(a_end_ms), utc_day_index(b_end_ms));
    return end >= start ? end - start + 1 : 0;
}
/** Round to 2 decimals. PURE. */
function round2(value) {
    return Math.round(value * 100) / 100;
}
/**
 * Derive the view periods for a budget in one view cadence + visible window.
 *
 * @param budget_id       - The budget being viewed
 * @param buckets         - The view's source-period buckets (weekly/bi-weekly)
 * @param monthly_periods - The budget's materialized MONTHLY periods overlapping
 *                          the window (carry allocated + effective for pro-ration)
 * @param splits          - Candidate splits assigned to `budget_id`, resolved
 *                          over the whole window against the canonical (monthly)
 *                          assignment. Each is re-bucketed by date here.
 *
 * PURE FUNCTION.
 */
function derive_budget_view_periods(budget_id, buckets, monthly_periods, splits) {
    return buckets.map((bucket) => {
        const spend = (0, budget_spend_service_1.compute_budget_spent)(budget_id, bucket.start_ms, bucket.end_ms, splits);
        // Pro-rate each overlapping monthly period's daily amount across the days it
        // overlaps this bucket. daily = amount / days-in-that-monthly-period.
        let allocated = 0;
        let effective = 0;
        for (const mp of monthly_periods) {
            const days = overlap_days(mp.start_ms, mp.end_ms, bucket.start_ms, bucket.end_ms);
            if (days === 0) {
                continue;
            }
            const mp_days = days_inclusive(mp.start_ms, mp.end_ms);
            if (mp_days <= 0) {
                continue;
            }
            allocated += (mp.allocated_amount / mp_days) * days;
            effective += (mp.effective_amount / mp_days) * days;
        }
        allocated = round2(allocated);
        effective = round2(effective);
        return {
            budget_id,
            period_id: bucket.period_id,
            period_type: bucket.period_type,
            start_ms: bucket.start_ms,
            end_ms: bucket.end_ms,
            allocated_amount: allocated,
            effective_amount: effective,
            spent: spend.spent,
            pending_spent: spend.pending_spent,
            return_amount: spend.return_amount,
            remaining: round2(effective - spend.spent),
            is_derived: true,
        };
    });
}
//# sourceMappingURL=budget_view.service.js.map