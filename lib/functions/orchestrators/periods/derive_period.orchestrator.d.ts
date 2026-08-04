/**
 * Derive Period Orchestrator (batched)
 *
 * Read-only coordination for a whole period view in ONE call: budgets (derived,
 * on-read matched), bills, and income for the requested cadence + window. Loads
 * the shared data once (resolver) then loops the pure services in memory —
 * collapsing the client's ~N callable round-trips into one and removing the
 * per-item re-reads.
 *
 * @module orchestrators/periods/derive_period
 */
import { TraceContext } from "../../types";
import { DerivedBudgetViewPeriod } from "../../domain/budgets/budget_view.service";
import { PlacedOccurrenceGroup } from "../../domain/recurring/occurrence_placement.service";
import { PeriodInstanceType } from "../../domain/budgets";
export interface DerivePeriodInput {
    view_cadence: PeriodInstanceType;
    window_start_ms: number;
    window_end_ms: number;
}
export interface DerivedBudgetResult {
    budget_id: string;
    name: string;
    is_everything_else: boolean;
    periods: DerivedBudgetViewPeriod[];
}
export interface DerivedRecurringResult {
    recurring_id: string;
    name: string;
    groups: PlacedOccurrenceGroup[];
}
export interface DerivePeriodResult {
    view_cadence: PeriodInstanceType;
    budgets: DerivedBudgetResult[];
    bills: DerivedRecurringResult[];
    income: DerivedRecurringResult[];
}
export declare function derive_period_orchestrator(ctx: TraceContext, user_id: string, input: DerivePeriodInput): Promise<DerivePeriodResult>;
//# sourceMappingURL=derive_period.orchestrator.d.ts.map