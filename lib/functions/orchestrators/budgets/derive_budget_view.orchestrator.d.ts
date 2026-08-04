/**
 * Derive Budget View Orchestrator
 *
 * Read-only coordination for the Derive-On-Read Period Architecture (Phase 1):
 * derive a budget's non-monthly VIEW (weekly / bi-weekly) for a bounded visible
 * window, computed from the single materialized monthly home + the splits.
 *
 * No idempotency, no events, no writes — a read. All work is bounded to the
 * requested window (the hard window bound from the design).
 *
 * @module orchestrators/budgets/derive_budget_view
 */
import { TraceContext } from "../../types";
import { SpendMatchMode } from "../../resolvers/budgets/budget_view.resolver";
import { DerivedBudgetViewPeriod } from "../../domain/budgets/budget_view.service";
import { PeriodInstanceType } from "../../domain/budgets";
/** Input for a budget-view derivation. */
export interface DeriveBudgetViewInput {
    budget_id: string;
    view_cadence: PeriodInstanceType;
    window_start_ms: number;
    window_end_ms: number;
    /** How to source spent: "stored" (interim) or "on_read" (instant-budget match). */
    match_mode?: SpendMatchMode;
}
/** Result: the derived view periods + the denormalized budget name. */
export interface DeriveBudgetViewResult {
    budget_id: string;
    budget_name: string;
    view_cadence: PeriodInstanceType;
    periods: DerivedBudgetViewPeriod[];
}
/**
 * Derive a budget's view periods for a window. Returns `null` when the budget
 * doesn't exist or isn't owned by the caller (entry maps that to not-found).
 */
export declare function derive_budget_view_orchestrator(ctx: TraceContext, user_id: string, input: DeriveBudgetViewInput): Promise<DeriveBudgetViewResult | null>;
//# sourceMappingURL=derive_budget_view.orchestrator.d.ts.map