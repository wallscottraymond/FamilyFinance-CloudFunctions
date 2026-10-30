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
import { TraceContext } from "../../types";
export interface ResnapUserCounts {
    outflows: number;
    outflow_periods_to_flip: number;
    inflows: number;
    inflow_periods_to_flip: number;
    /** Not flipped (reported only): an OLD (unstamped) income's periods stored active inside its
     *  removal window — the old creators never suppressed them. */
    old_income_in_window_periods: number;
    /** Not flipped (reported only): the same for bills and v2 incomes. */
    other_in_window_periods: number;
}
export interface ResnapResult {
    write: boolean;
    records_checked: number;
    periods_flipped: number;
    by_user: Record<string, ResnapUserCounts>;
}
export declare function resnap_period_suppression_orchestrator(ctx: TraceContext, opts?: {
    write?: boolean;
    user_id?: string;
}): Promise<ResnapResult>;
//# sourceMappingURL=resnap_period_suppression.orchestrator.d.ts.map