"use strict";
/**
 * Match Source Periods Domain Service
 *
 * Pure logic mapping a transaction date to the source-period ids it falls in:
 * one monthly, one weekly, one bi-monthly. Source periods are app-wide; the
 * resolver loads the ones overlapping the date and this picks one of each type.
 *
 * NOTE: the bi-monthly source period carries `type: "bi_monthly"` and fills the
 * `bi_weekly_period_id` split field (legacy field name).
 *
 * NO async, NO IO, NO side effects. Time injected as epoch ms.
 *
 * @module domain/transactions/match_source_periods
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.match_source_periods = match_source_periods;
/**
 * Pick the monthly / weekly / bi-monthly source period containing the date.
 *
 * Inclusive on both bounds (`start <= date <= end`), matching the legacy util.
 * Missing types yield null. If multiple periods of one type contain the date
 * (shouldn't happen), the first in the input wins.
 *
 * PURE FUNCTION.
 */
function match_source_periods(txn_date_ms, source_periods) {
    let monthly = null;
    let weekly = null;
    let bi_monthly = null;
    for (const period of source_periods) {
        if (txn_date_ms < period.start_ms || txn_date_ms > period.end_ms) {
            continue;
        }
        if (period.type === "monthly" && monthly === null) {
            monthly = period.id;
        }
        else if (period.type === "weekly" && weekly === null) {
            weekly = period.id;
        }
        else if (period.type === "bi_monthly" && bi_monthly === null) {
            bi_monthly = period.id;
        }
    }
    return {
        monthly_period_id: monthly,
        weekly_period_id: weekly,
        bi_weekly_period_id: bi_monthly,
    };
}
//# sourceMappingURL=match_source_periods.service.js.map