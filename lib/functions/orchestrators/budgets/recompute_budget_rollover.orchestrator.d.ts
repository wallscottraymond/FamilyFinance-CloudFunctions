/**
 * Recompute Budget Rollover Orchestrator
 *
 * The real-time half of the rollover system (the other half is the 3 AM
 * `calculateDailyRollover` catch-up). When the spend pipeline changes a budget's
 * `spent`, that budget's rollover chain becomes invalid — each period's
 * `rolledOverAmount` derives from the previous period's `allocated + rollover −
 * spent`. This orchestrator recomputes the chain and refreshes the summaries the
 * app renders.
 *
 * Dispatched from the `_jobs` queue as `recalculate_rollover`, enqueued by
 * `recompute_budget_spent` ONLY for budgets with `rolloverEnabled` (see there).
 *
 * Loop-safety: the chain writes `rolledOverAmount`/`remaining` but NEVER `spent`,
 * and rollover jobs are enqueued solely from the spend pipeline (driven by
 * transaction writes) — so a rollover write cannot re-enter the spend pipeline
 * or re-enqueue itself.
 *
 * NOTE (legacy coupling): the chain math + its period query/writes live in the
 * legacy `budgets/utils/rolloverChainCalculation` (owns its own reads/writes,
 * like a scoped repo). This orchestrator delegates to it — the same pattern
 * `process_budget_period_edited` uses for the sync utils.
 *
 * @module orchestrators/budgets/recompute_budget_rollover
 */
import { TraceContext } from "../../types";
/** Payload from the spend pipeline's fan-out (dedup key = budget_id). */
export interface RecomputeBudgetRolloverInput {
    user_id: string;
    /** The budget whose spend changed → rollover chain is now invalid. */
    budget_id: string;
    /** Optional: recompute only from this period forward (else the whole chain). */
    start_from_period_id?: string;
}
/**
 * Recompute the rollover chain for one budget, then refresh the affected
 * summaries.
 *
 * @returns Count of periods whose rollover/remaining changed.
 */
export declare function recompute_budget_rollover_orchestrator(ctx: TraceContext, input: RecomputeBudgetRolloverInput): Promise<{
    periods_updated: number;
}>;
//# sourceMappingURL=recompute_budget_rollover.orchestrator.d.ts.map