"use strict";
/**
 * derive_period response mapper — the ONE mapping from a derived period result to the client
 * wire format. Shared by `derive_period` and `derive_period_range` so both return identical
 * shapes (the mobile `periodDeriveService` cache stores either interchangeably).
 *
 * @module entry/callable/mappers/derive_period.mapper
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.map_derive_period_result = map_derive_period_result;
// Client wire format (camelCase, consumed as-is by the mobile app).
/* eslint-disable @typescript-eslint/naming-convention */
function map_budget(b) {
    var _a;
    return {
        budgetId: b.budget_id,
        name: b.name,
        isEverythingElse: b.is_everything_else,
        isFund: b.is_fund === true,
        // User-facing first_category slugs the budget owns ([] for Everything Else / manual budgets).
        firstCategoryIds: (_a = b.first_category_ids) !== null && _a !== void 0 ? _a : [],
        periods: b.periods.map((p) => {
            var _a, _b, _c, _d, _e, _f, _g;
            return (Object.assign({ periodId: p.period_id, periodType: p.period_type, allocatedAmount: p.allocated_amount, effectiveAmount: p.effective_amount, spent: p.spent, 
                // Per UTC day of the period (index 0 = first day); sums to `spent` (budget daily chart).
                dailySpent: (_a = p.daily_spent) !== null && _a !== void 0 ? _a : [], 
                // "Easy to change" tips — from the same counted splits as `spent`.
                dailyCount: (_b = p.daily_count) !== null && _b !== void 0 ? _b : [], places: ((_c = p.places) !== null && _c !== void 0 ? _c : []).map((pl) => {
                    var _a;
                    return ({
                        key: pl.key, name: pl.name, count: pl.count, smallCount: pl.small_count, total: pl.total,
                        code: (_a = pl.code) !== null && _a !== void 0 ? _a : "",
                    });
                }), fees: (_d = p.fees) !== null && _d !== void 0 ? _d : [], returnAmount: p.return_amount, remaining: p.remaining, isDerived: true, 
                // Everything-Else only: no expected income → FE prompts instead of a negative.
                noIncome: (_e = p.no_income) !== null && _e !== void 0 ? _e : false, 
                // Budget pause (Code-Health-Review PZ3/PZ5): every day paused → "Paused" (sorted last);
                // some → "Partly paused". Paused days' spending is in Everything Else.
                isPaused: (_f = p.is_paused) !== null && _f !== void 0 ? _f : false, pausedDays: (_g = p.paused_days) !== null && _g !== void 0 ? _g : 0 }, (p.fund_total !== undefined ? { fundTotal: p.fund_total, fundSpentToDate: p.fund_spent_to_date } : {})));
        }),
    };
}
function map_recurring(r) {
    return Object.assign({ recurringId: r.recurring_id, name: r.name, groups: r.groups.map((g) => (Object.assign(Object.assign({ periodId: g.period_id, countInPeriod: g.count_in_period, countPaid: g.count_paid, totalDue: g.total_due, totalPaid: g.total_paid, totalUnpaid: g.total_unpaid, isDuePeriod: g.is_due_period }, (g.paused_until_ms !== undefined ? { pausedUntilMs: g.paused_until_ms } : {})), { isFullyPaid: g.is_fully_paid, status: g.status, occurrences: g.occurrences.map((o) => (Object.assign(Object.assign(Object.assign({ dueMs: o.due_ms, paid: o.paid, amount: o.amount }, (o.expected_amount !== undefined ? { expectedAmount: o.expected_amount } : {})), (o.manual ? { manual: true } : {})), (o.transaction_id ? { transactionId: o.transaction_id } : {})))), firstDueMs: g.first_due_ms, nextUnpaidDueMs: g.next_unpaid_due_ms }))) }, (r.owner_user_id ? { ownerUserId: r.owner_user_id } : {}));
}
/** Client wire format for one derived period (`derive_period`'s `data`). */
function map_derive_period_result(result) {
    return {
        viewCadence: result.view_cadence,
        budgets: result.budgets.map(map_budget),
        bills: result.bills.map(map_recurring),
        income: result.income.map(map_recurring),
    };
}
//# sourceMappingURL=derive_period.mapper.js.map