/**
 * Period View Service (pure)
 *
 * Derives a WHOLE period view — budgets (on-read matched), bills, income (generate → reconcile →
 * place), the synthetic "Other Income" bucket, and the Everything-Else leftover — from one
 * window's resolved inputs. Pure + deterministic: no IO, no clock. Shared by `derive_period`
 * (one window) and `derive_period_range` (many windows from one load), so every window's result
 * is computed by exactly the same code.
 *
 * @module domain/periods/period_view.service
 */
import { PeriodInstanceType } from "../budgets";
import { DerivedBudgetViewPeriod } from "../budgets/budget_view.service";
import { PlacedOccurrenceGroup } from "../recurring/occurrence_placement.service";
import { PeriodDerivationDeps } from "./period_derivation.types";
/** Synthetic income id for the "Other Income" bucket (unmatched real INCOME_* credits). */
export declare const OTHER_INCOME_ID = "__other_income__";
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
export declare function compute_period_view(deps: PeriodDerivationDeps, view_cadence: PeriodInstanceType): DerivePeriodResult;
//# sourceMappingURL=period_view.service.d.ts.map