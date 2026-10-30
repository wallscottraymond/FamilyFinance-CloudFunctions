/**
 * Recompute Budget Spent Orchestrator
 *
 * The Budget-Transaction-Spend-Pipeline consumer of the assignment engine's
 * fan-out. For each touched budget, finds the period(s) containing the
 * transaction's date and RECOMPUTES their `spent`/`pendingSpent`/`remaining`
 * from the currently-assigned splits (invalidation-based — never incremented),
 * then refreshes the affected user_summary documents.
 *
 * Dispatched from the `_jobs` queue as `recompute_budget_spent`.
 *
 * @module orchestrators/budgets/recompute_budget_spent
 */
import { TraceContext } from "../../types";
/** Payload from the assignment engine's fan-out. */
export interface RecomputeBudgetSpentInput {
    user_id: string;
    /** Budgets whose spend may have changed (before ∪ after). */
    budget_ids: string[];
    /**
     * The transaction's date — scopes recompute to the period(s) containing it.
     * OMITTED by the backfill, which recomputes EVERY period of each budget
     * (needed because spent must be rebuilt even where no assignment changed).
     */
    transaction_date_ms?: number;
    /**
     * Many dates at once (a sync's follow-up pass): budget id → transaction dates. Recomputes each
     * budget's periods containing ANY of its dates, in one job — instead of one job per day.
     */
    dates_ms_by_budget?: Record<string, number[]>;
    /**
     * Read the user's transactions across ALL the affected periods ONCE and slice each window from
     * memory (a convert touches ~100 windows of one year; each was its own read). Opt-in: callers
     * that don't pass it read exactly as before.
     */
    preload_window?: boolean;
}
/**
 * Recompute spent for the touched budgets' affected periods.
 *
 * @returns Count of periods updated.
 */
export declare function recompute_budget_spent_orchestrator(ctx: TraceContext, input: RecomputeBudgetSpentInput): Promise<{
    periods_updated: number;
}>;
//# sourceMappingURL=recompute_budget_spent.orchestrator.d.ts.map