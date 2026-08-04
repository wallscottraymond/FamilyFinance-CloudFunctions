/**
 * Period Derivation Resolver (batched)
 *
 * READ-ONLY: load EVERYTHING a period view needs in one batch — the user's
 * budgets (+ their monthly homes), the window's source-period buckets, the
 * window's transaction splits (for on-read budget matching AND recurring
 * reconciliation), and the user's recurring outflows/inflows — so the whole
 * period can be derived in a SINGLE server round-trip instead of one callable
 * per budget/bill/income.
 *
 * Reuses the same pure services as the per-item paths; the win is doing the IO
 * once and looping in memory. No writes.
 *
 * @module resolvers/periods/period_derivation
 */
import { TraceContext } from "../../types";
import { ViewBucket, MonthlyPeriodForDerivation } from "../../domain/budgets/budget_view.service";
import { SplitForOnReadMatch } from "../../domain/budgets/budget_spend_match.service";
import { BudgetForMatch } from "../../domain/transactions/match_budget.service";
import { PlacementBucket } from "../../domain/recurring/occurrence_placement.service";
import { ActualPayment } from "../../domain/recurring/reconcile_occurrences.service";
import { RecurringScheduleForGeneration } from "../../domain/outflows/outflow_period.service";
import { PeriodInstanceType } from "../../domain/budgets";
export interface BudgetForDerivation {
    id: string;
    name: string;
    is_ee: boolean;
    monthly_periods: MonthlyPeriodForDerivation[];
}
export interface RecurringForDerivation {
    id: string;
    name: string;
    kind: "outflow" | "inflow";
    schedule: RecurringScheduleForGeneration;
    payments: ActualPayment[];
}
export interface PeriodDerivationDeps {
    view_buckets: ViewBucket[];
    placement_buckets: PlacementBucket[];
    budgets: BudgetForDerivation[];
    real_budgets: BudgetForMatch[];
    monthly_ee_id: string | null;
    any_ee_id: string | null;
    splits_for_match: SplitForOnReadMatch[];
    recurring: RecurringForDerivation[];
    span_start_ms: number;
    span_end_ms: number;
}
export declare function resolve_period_derivation_deps(ctx: TraceContext, user_id: string, view_cadence: PeriodInstanceType, window_start_ms: number, window_end_ms: number): Promise<PeriodDerivationDeps>;
//# sourceMappingURL=period_derivation.resolver.d.ts.map