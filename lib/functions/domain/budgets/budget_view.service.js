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
const period_allocation_view_service_1 = require("./period_allocation_view.service");
const budget_pause_service_1 = require("./budget_pause.service");
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
function derive_budget_view_periods(budget_id, buckets, monthly_periods, splits, active_start_ms, active_end_ms, priced, paused) {
    var _a, _b, _c, _d;
    const result = [];
    // A paused day's spending is Everything Else's (PZ1). The on-read owner rule already moved it;
    // this also covers callers that pass STORED-assignment splits (derive_budget_view "stored").
    const counted = paused && paused.length > 0
        ? splits.filter((s) => !(0, budget_pause_service_1.is_paused_on)(paused, s.txn_date_ms))
        : splits;
    for (const bucket of buckets) {
        // A budget must not appear in periods outside its active range — a bucket that ends before the
        // budget's first period (e.g. a newly-created budget shown in past periods) or starts after it
        // ended is omitted entirely. When the range is unset, all buckets are emitted (prior behavior).
        if (active_start_ms !== undefined && bucket.end_ms < active_start_ms) {
            continue;
        }
        if (active_end_ms != null && bucket.start_ms > active_end_ms) {
            continue;
        }
        const bucket_days = (0, budget_pause_service_1.utc_day)(bucket.end_ms) - (0, budget_pause_service_1.utc_day)(bucket.start_ms) + 1;
        const spend = (0, budget_spend_service_1.compute_budget_spent)(budget_id, bucket.start_ms, bucket.end_ms, counted, { start_ms: bucket.start_ms, days: bucket_days });
        // THE page rule (domain/budgets/period_allocation_view): each overlapping monthly period's
        // daily amount × days overlapped, plus the "This Period Only" adjustments by their own range.
        // A pause (PZ1) takes the paused days' share out; spend on those days is already Everything
        // Else's (resolve_split_owner), so it never reaches `splits` here.
        const { allocated, effective } = (0, period_allocation_view_service_1.bucket_allocation_unpaused)(monthly_periods, bucket.start_ms, bucket.end_ms, priced, paused);
        const paused_days = (0, budget_pause_service_1.paused_days_in)(paused, bucket.start_ms, bucket.end_ms);
        result.push({
            budget_id,
            period_id: bucket.period_id,
            period_type: bucket.period_type,
            start_ms: bucket.start_ms,
            end_ms: bucket.end_ms,
            allocated_amount: allocated,
            effective_amount: effective,
            spent: spend.spent,
            daily_spent: (_a = spend.daily_spent) !== null && _a !== void 0 ? _a : [],
            daily_count: (_b = spend.daily_count) !== null && _b !== void 0 ? _b : [],
            places: (_c = spend.places) !== null && _c !== void 0 ? _c : [],
            fees: (_d = spend.fees) !== null && _d !== void 0 ? _d : [],
            pending_spent: spend.pending_spent,
            return_amount: spend.return_amount,
            remaining: (0, period_allocation_view_service_1.round2)(effective - spend.spent),
            is_derived: true,
            paused_days,
            is_paused: paused_days > 0 && paused_days >= bucket_days,
        });
    }
    return result;
}
//# sourceMappingURL=budget_view.service.js.map