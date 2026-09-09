"use strict";
/**
 * Everything-Else Leftover — the EE budget's LIMIT is the derived, unallocated
 * cash you have left to spend for a period:
 *
 *   EE_limit = expected income − bills due − goal set-aside − Σ other budgets' allocated
 *
 * (per viewed cadence; zero-based-budgeting remainder). PURE — no IO.
 * See FamilyFinanceObsidian/1 Projects/Everything-Else-Leftover-Limit.md.
 *
 * @module domain/budgets/everything_else_leftover
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compute_ee_leftovers = compute_ee_leftovers;
const goal_service_1 = require("../goals/goal.service");
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Compute the Everything-Else leftover per view bucket. PURE.
 *
 * Goals are translated to each bucket's day-span (`amount_for_span`), consistent
 * with how budgets pro-rate across cadences. A negative leftover means the user
 * has committed more than their expected income (over-allocated) — surfaced as-is.
 */
function compute_ee_leftovers(buckets, goals) {
    const out = new Map();
    for (const b of buckets) {
        const span_days = Math.max(1, (b.end_ms - b.start_ms) / DAY_MS);
        const goal_draws = goals.reduce((sum, g) => sum + (0, goal_service_1.amount_for_span)(g.per_period_amount, g.home_cadence, span_days), 0);
        const leftover = round2(b.expected_income - b.bills_due - goal_draws - b.other_budgets_allocated);
        out.set(b.period_id, { leftover, has_income: b.expected_income > 0 });
    }
    return out;
}
function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}
//# sourceMappingURL=everything_else_leftover.service.js.map