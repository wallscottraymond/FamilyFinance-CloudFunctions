/**
 * Period derivation types — the inputs a whole-period view is derived from.
 *
 * Produced by the period-derivation resolver (IO + lookup shaping) and consumed by the pure
 * `compute_period_view` domain service. Kept in the domain layer so the pure computation never
 * imports from a resolver.
 *
 * @module domain/periods/period_derivation.types
 */
import { GoalForLeftover } from "../budgets/everything_else_leftover.service";
import { ViewBucket, MonthlyPeriodForDerivation } from "../budgets/budget_view.service";
import { SplitForOnReadMatch } from "../budgets/budget_spend_match.service";
import { BudgetForMatch } from "../transactions/match_budget.service";
import { PlacementBucket } from "../recurring/occurrence_placement.service";
import { ActualPayment } from "../recurring/reconcile_occurrences.service";
import { RemovalInterval } from "../recurring/recurring_suppression.service";
import { DepositForSlot } from "../recurring/income_slot_amounts";
import { RecurringScheduleForGeneration } from "../outflows/outflow_period.service";
export interface BudgetForDerivation {
    id: string;
    name: string;
    is_ee: boolean;
    monthly_periods: MonthlyPeriodForDerivation[];
    /** Start of the budget's first active period (snapped); a view period ending before this is
     *  omitted so a budget never appears in periods predating it. EE uses 0 (always active). */
    active_start_ms: number;
    /** End of the budget's active range, or null if ongoing. Periods after it are omitted. */
    active_end_ms: number | null;
}
export interface RecurringForDerivation {
    id: string;
    name: string;
    kind: "outflow" | "inflow";
    schedule: RecurringScheduleForGeneration;
    payments: ActualPayment[];
    /** INCOME only: the stream's historical linked deposits, for per-slot amount estimation
     *  (a semi-monthly stream's mid vs end occurrence draw from their own slot's average). */
    payment_history?: DepositForSlot[];
    /** INCOME only: true when the user set an explicit expected-amount override on the stream
     *  ("this + future"). An explicit override MUST win over the per-slot auto-estimate — else
     *  the user's edit is silently ignored for multi-occurrence income (semi-monthly/weekly). */
    has_amount_override?: boolean;
    /** INCOME only: per-occurrence expected overrides keyed by UTC due-date `YYYY-MM-DD`.
     *  Wins over the per-slot auto-estimate AND the definition override, for that ONE occurrence. */
    occurrence_amount_overrides?: Record<string, number>;
    /** User remove/pause spans — occurrences in a suppressed period are dropped on read. */
    removal_intervals: RemovalInterval[];
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
    /** Active income-drawing goals' planned set-aside (for the EE leftover). */
    goals: GoalForLeftover[];
    /** Real INCOME_* credits in the window not tied to any recurring inflow (→ "Other income"). */
    other_income_credits: DepositForSlot[];
    span_start_ms: number;
    span_end_ms: number;
}
//# sourceMappingURL=period_derivation.types.d.ts.map