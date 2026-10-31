"use strict";
/**
 * A period's share of its budget under the PERIOD PAGE's rule (Transaction-Integrity X10,
 * "All Periods Forward").
 *
 * The page builds every view's allocation from the budget's MONTHLY home docs, spreading each
 * month evenly over its days (domain/budgets/period_allocation_view). So with no overrides or
 * adjustments, a period's allocation per $1 of `budget.amount` is Σ over its UTC days of the
 * month home's daily share, by the budget's cadence:
 *  - weekly     → 1/7 (the monthly home = the weekly primes' daily rate × the month's days);
 *  - bi_monthly → 2/month days (the monthly home holds 2 halves, spread evenly);
 *  - monthly / custom / unknown → 1/month days;
 *  - quarterly / yearly (monthly grid, each month gets a third / a twelfth of the amount —
 *    `budget_amount_per_instance`) → (1/3 or 1/12)/month days.
 * "All Periods Forward": new budget amount = typed amount ÷ this share, so the edited period then
 * shows what was typed (to the cent, modulo rounding of the stored monthly home). PURE.
 *
 * Partial months (batch 6 verify #3): generation prices a monthly record only over the budget's
 * PRICED days (`budget_priced_range`) and the page spreads it over those days alone
 * (`bucket_allocation`). So with `priced`, each day counts the month's price
 * (`monthly_price_unrounded`) ÷ the month's priced days, and days outside the range count 0.
 * Without `priced` every month is whole, which reduces to the per-cadence rules above.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.page_share = page_share;
const period_generation_service_1 = require("./period_generation.service");
const period_allocation_view_service_1 = require("./period_allocation_view.service");
const DAY_MS = 86400000;
/**
 * Priced per this many dollars, then scaled back: generation rounds each prime's daily rate to 6
 * decimals, which is noise at $1 but nothing at this size.
 */
const REFERENCE_AMOUNT = 1000000;
const WHOLE_MONTHS = { from_ms: Number.NEGATIVE_INFINITY, to_ms: null };
/** The period [start_ms, end_ms] (inclusive, any time of day)'s share of a budget of `cadence`. */
function page_share(start_ms, end_ms, cadence, priced = WHOLE_MONTHS) {
    const period = String(cadence !== null && cadence !== void 0 ? cadence : "monthly");
    const first_priced = priced.from_ms === Number.NEGATIVE_INFINITY ? -Infinity : (0, period_allocation_view_service_1.utc_day_index)(priced.from_ms);
    const last_priced = priced.to_ms == null ? Infinity : (0, period_allocation_view_service_1.utc_day_index)(priced.to_ms);
    const per_day_by_month = new Map();
    let share = 0;
    for (let day = (0, period_allocation_view_service_1.utc_day_index)(start_ms); day <= (0, period_allocation_view_service_1.utc_day_index)(end_ms); day++) {
        if (day < first_priced || day > last_priced)
            continue;
        const d = new Date(day * DAY_MS);
        const month_start_ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
        let per_day = per_day_by_month.get(month_start_ms);
        if (per_day === undefined) {
            const month_end_ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1;
            const first = Math.max((0, period_allocation_view_service_1.utc_day_index)(month_start_ms), first_priced);
            const last = Math.min((0, period_allocation_view_service_1.utc_day_index)(month_end_ms), last_priced);
            const priced_days = last - first + 1;
            const price = (0, period_generation_service_1.monthly_price_unrounded)(REFERENCE_AMOUNT, period, month_start_ms, month_end_ms, priced);
            per_day = priced_days > 0 ? price / REFERENCE_AMOUNT / priced_days : 0;
            per_day_by_month.set(month_start_ms, per_day);
        }
        share += per_day;
    }
    return share;
}
//# sourceMappingURL=period_share.service.js.map