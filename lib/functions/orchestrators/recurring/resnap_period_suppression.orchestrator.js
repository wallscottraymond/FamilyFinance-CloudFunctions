"use strict";
/**
 * Re-snap stored periods to the month rule (Convert-To-Recurring D27) — the ONE-OFF that brings
 * existing materialized periods in line with the rule `apply_period_suppression` and the period
 * creators now apply: a sub-month period of a removed / paused / ended bill or income is active
 * when any of its occurrences is in a month that isn't suppressed (the derive's rule, b6a8281).
 *
 * Input: every ACTIVE bill / income that carries removal intervals (all users, or one). SCOPE
 * (round 4 defect 4, `resnap_period_decision`): a period is flipped ONLY when it is still in the
 * state the OLD whole-period rule gave it AND the month rule now differs — a period inactive (or
 * active) for any other reason is left alone. With `write` the flip writes ONLY `isActive` (no
 * `updatedAt`, nothing else). Inactive records (account removed / stale) are never touched.
 * The dry run also reports, SEPARATELY and never flipped, periods stored active although both
 * rules say inactive (old incomes' periods the old creators made active inside the removal
 * window: `old_income_in_window_periods`; anything else of that kind: `other_in_window_periods`).
 * Dry run by default. Idempotent: a second run finds nothing.
 *
 * CLI: `scripts/resnap-period-suppression.js` (dry run; `--write`; `--user <uid>`). NOT run against
 * prod without the user's approval (dev == prod).
 *
 * @module orchestrators/recurring/resnap_period_suppression
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resnap_period_suppression_orchestrator = resnap_period_suppression_orchestrator;
const repositories_1 = require("../../repositories");
async function resnap_period_suppression_orchestrator(ctx, opts = {}) {
    const write = opts.write === true;
    const result = { write, records_checked: 0, periods_flipped: 0, by_user: {} };
    const counts = (uid) => {
        var _a;
        var _b;
        return ((_a = (_b = result.by_user)[uid]) !== null && _a !== void 0 ? _a : (_b[uid] = {
            outflows: 0, outflow_periods_to_flip: 0, inflows: 0, inflow_periods_to_flip: 0,
            old_income_in_window_periods: 0, other_in_window_periods: 0,
        }));
    };
    for (const [kind, repo] of [["outflow", repositories_1.outflow_repo], ["inflow", repositories_1.inflow_repo]]) {
        const records = await repo.list_active_with_removal_intervals(ctx, opts.user_id);
        for (const r of records) {
            result.records_checked++;
            const stats = { in_window_active: 0 };
            const n = await repo.apply_period_suppression(ctx, r.id, r.removal_intervals, r.owner_id, {
                dry_run: !write,
                touch_updated_at: false,
                resnap: true,
                stats,
            });
            const c = counts(r.owner_id);
            if (kind === "inflow" && !r.v2)
                c.old_income_in_window_periods += stats.in_window_active;
            else
                c.other_in_window_periods += stats.in_window_active;
            if (kind === "outflow") {
                c.outflows++;
                c.outflow_periods_to_flip += n;
            }
            else {
                c.inflows++;
                c.inflow_periods_to_flip += n;
            }
            result.periods_flipped += n;
        }
    }
    console.log(`[${ctx.trace_id}] resnap_period_suppression ${write ? "WRITE" : "DRY RUN"}: ` +
        `${result.records_checked} record(s), ${result.periods_flipped} period(s) ${write ? "flipped" : "to flip"}`);
    return result;
}
//# sourceMappingURL=resnap_period_suppression.orchestrator.js.map