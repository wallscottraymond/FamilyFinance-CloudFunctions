/**
 * Set Budget Pause Orchestrator (Code-Health-Review M1-M1, PZ1–PZ6)
 *
 * Pause / resume a budget for exactly the days of one period. Only the budget's `pausedRanges`
 * is written — never a split: read time moves a paused day's spending to Everything Else and
 * takes the paused days' share out of the budget (derive_period, derive_budget_transactions,
 * widgets, Home — one owner rule). Then:
 *   - bump the derive version (24h caches) AFTER the write
 *   - recompute the stored `spent` of the periods holding those days (it leaves paused days out,
 *     so the rollover chain carries exactly what the page shows — PZ6)
 *
 * Idempotent by construction (pause = union, resume = subtract); a concurrent change to the same
 * budget's ranges is retried, never overwritten.
 *
 * @module orchestrators/budgets/set_budget_pause
 */
import { TraceContext } from "../../types";
import { SetBudgetPauseInput, SetBudgetPauseResponse } from "../../types/budgets/set_budget_pause.types";
export declare function set_budget_pause_orchestrator(ctx: TraceContext, user_id: string, input: SetBudgetPauseInput): Promise<SetBudgetPauseResponse>;
//# sourceMappingURL=set_budget_pause.orchestrator.d.ts.map