"use strict";
/**
 * Goal Measurement Resolver — Goals (Phase 1)
 *
 * Read-only. For a viewed period, computes each active goal's per-period progress
 * from balance snapshots, attributing a shared account's movement across its
 * goals by priority order (fill the top-ranked goal's target first).
 *
 * Direction is goal-type-aware: save/purchase/invest measure the account balance
 * GROWING; debt_paydown measures the liability balance DROPPING.
 *
 * The pure shaping (met / target_reached / rounding) is delegated to the domain
 * service; this resolver only reads + attributes.
 *
 * @module resolvers/goals/goal_measurement
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_goal_measurements = resolve_goal_measurements;
const goal_repo_1 = require("../../repositories/goal.repo");
const balance_snapshot_repo_1 = require("../../repositories/balance_snapshot.repo");
const goal_service_1 = require("../../domain/goals/goal.service");
const DAY_MS = 24 * 60 * 60 * 1000;
function is_debt(g) {
    return g.goal_type === "debt_paydown";
}
/** Priority-fill a pool across goals (sorted by priority_rank asc). */
function allocate_by_priority(pool, goals_sorted, target_of) {
    const out = new Map();
    let remaining = Math.max(0, pool);
    for (const g of goals_sorted) {
        const target = Math.max(0, target_of(g));
        const allocated = Math.min(remaining, target);
        out.set(g.id, allocated);
        remaining -= allocated;
    }
    return out;
}
async function resolve_goal_measurements(ctx, user_id, period_id, period_start, period_end) {
    var _a, _b, _c, _d;
    const goals = await goal_repo_1.goal_repo.get_by_user(ctx, user_id);
    if (goals.length === 0)
        return [];
    const span_days = Math.max(1, (period_end.toMillis() - period_start.toMillis()) / DAY_MS);
    const target_for = (g) => (0, goal_service_1.amount_for_span)(g.per_period_amount, g.home_cadence, span_days);
    // Group by watched account so partition + one snapshot read happens per account.
    const by_account = new Map();
    for (const g of goals) {
        const list = (_a = by_account.get(g.linked_account_id)) !== null && _a !== void 0 ? _a : [];
        list.push(g);
        by_account.set(g.linked_account_id, list);
    }
    const views = [];
    for (const [account_id, account_goals] of by_account.entries()) {
        const start_snap = await balance_snapshot_repo_1.balance_snapshot_repo.get_at_or_before(account_id, period_start);
        const end_snap = await balance_snapshot_repo_1.balance_snapshot_repo.get_at_or_before(account_id, period_end);
        const data_incomplete = !start_snap || !end_snap;
        const gain = start_snap && end_snap
            ? end_snap.currentBalance - start_snap.currentBalance
            : 0;
        const latest_balance = (_c = (_b = end_snap === null || end_snap === void 0 ? void 0 : end_snap.currentBalance) !== null && _b !== void 0 ? _b : start_snap === null || start_snap === void 0 ? void 0 : start_snap.currentBalance) !== null && _c !== void 0 ? _c : null;
        // Attribute the account's movement per direction, by priority.
        const save_goals = account_goals
            .filter((g) => !is_debt(g))
            .sort((a, b) => a.priority_rank - b.priority_rank);
        const debt_goals = account_goals
            .filter(is_debt)
            .sort((a, b) => a.priority_rank - b.priority_rank);
        const save_alloc = allocate_by_priority(Math.max(0, gain), save_goals, target_for);
        const debt_alloc = allocate_by_priority(Math.max(0, -gain), debt_goals, target_for);
        for (const g of account_goals) {
            const allocated = (_d = (is_debt(g) ? debt_alloc.get(g.id) : save_alloc.get(g.id))) !== null && _d !== void 0 ? _d : 0;
            const latest = latest_balance !== null && latest_balance !== void 0 ? latest_balance : g.baseline_balance;
            const cumulative = is_debt(g)
                ? g.baseline_balance - latest // liability dropping = progress
                : g.baseline_counts_existing
                    ? latest
                    : latest - g.baseline_balance;
            const measurement = (0, goal_service_1.compute_goal_measurement)({
                goal_id: g.id,
                period_id,
                target_for_period: target_for(g),
                attributed_progress: allocated,
                cumulative_progress: cumulative,
                target_amount: g.target_amount,
                data_incomplete,
            });
            views.push({ goal: g, measurement });
        }
    }
    return views;
}
//# sourceMappingURL=goal_measurement.resolver.js.map