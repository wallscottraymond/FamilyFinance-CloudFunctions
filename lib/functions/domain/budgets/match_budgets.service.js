"use strict";
/**
 * Match budgets — THE budget set every split-to-budget decision uses (canon A11 "stored ==
 * derived"): the assignment engine (what's STORED), the period page, a budget's transaction list
 * and its spend (what's COUNTED) all build their budgets here, so they can't disagree on which
 * budgets exist for a date.
 *
 *   - A real budget is active from the START OF ITS OWN-CADENCE PERIOD that contains its start
 *     date (a budget created mid-month owns that month's earlier purchases — its allocation covers
 *     the whole period), through `budget_end_date` (the user's end for a limited budget; the legacy
 *     `end_date` is only the first period's end) — or forever when ongoing.
 *   - Budgets of EVERY cadence own their categories in every lens (a weekly Groceries budget owns
 *     groceries in the monthly view too — as the period page counts it).
 *   - Everything Else is the structural fallback, one per lens.
 *
 * Source periods are calendar-exact (UTC): months; halves 1–15 / 16–end; weeks starting Sunday.
 *
 * PURE.
 *
 * @module domain/budgets/match_budgets
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.period_start_ms = period_start_ms;
exports.build_match_budgets = build_match_budgets;
exports.budget_to_match_input = budget_to_match_input;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Start (ms) of the cadence period containing `ms` — same bounds as the source periods. */
function period_start_ms(ms, cadence) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    if (cadence === "monthly")
        return Date.UTC(y, m, 1);
    if (cadence === "bi_monthly")
        return Date.UTC(y, m, d.getUTCDate() <= 15 ? 1 : 16);
    const day_start = Date.UTC(y, m, d.getUTCDate());
    return day_start - d.getUTCDay() * DAY_MS; // weekly: back to Sunday
}
function build_match_budgets(budgets) {
    var _a, _b;
    const real_budgets = [];
    const everything_else_ids = {
        monthly: null,
        weekly: null,
        bi_monthly: null,
    };
    const names = {};
    const ee_set = new Set();
    let any_ee = null;
    for (const b of budgets) {
        names[b.id] = b.name;
        if (b.is_everything_else) {
            any_ee = any_ee !== null && any_ee !== void 0 ? any_ee : b.id;
            ee_set.add(b.id);
            if (!everything_else_ids[b.cadence])
                everything_else_ids[b.cadence] = b.id;
            continue;
        }
        real_budgets.push({
            id: b.id,
            category_ids: (_a = b.category_ids) !== null && _a !== void 0 ? _a : [],
            start_ms: period_start_ms(b.start_ms, b.cadence),
            end_ms: b.is_ongoing ? null : b.end_ms,
            is_ongoing: b.is_ongoing,
            cadence: b.cadence,
        });
    }
    return {
        real_budgets,
        everything_else_ids,
        primary_everything_else_id: (_b = everything_else_ids.monthly) !== null && _b !== void 0 ? _b : any_ee,
        everything_else_id_set: ee_set,
        names,
    };
}
/** The stored budget → the builder's input (the one place `budget_end_date ?? end_date` lives). */
function budget_to_match_input(b) {
    var _a, _b, _c;
    const cadence = b.period === "weekly" ? "weekly" : b.period === "bi_monthly" ? "bi_monthly" : "monthly";
    const end = (_b = (_a = b.budget_end_date) !== null && _a !== void 0 ? _a : b.end_date) !== null && _b !== void 0 ? _b : null;
    return {
        id: b.id,
        name: b.name,
        cadence,
        category_ids: (_c = b.category_ids) !== null && _c !== void 0 ? _c : [],
        start_ms: b.start_date.toMillis(),
        end_ms: end ? end.toMillis() : null,
        is_ongoing: b.is_ongoing,
        is_everything_else: b.is_system_everything_else === true,
    };
}
//# sourceMappingURL=match_budgets.service.js.map