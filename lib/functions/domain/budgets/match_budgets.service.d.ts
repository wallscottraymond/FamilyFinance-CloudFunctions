/**
 * Match budgets — THE budget set every split-to-budget decision uses (canon A11 "stored ==
 * derived"): the assignment engine (what's STORED), the period page, a budget's transaction list
 * and its spend (what's COUNTED) all build their budgets here, so they can't disagree on which
 * budgets exist for a date.
 *
 *   - A real budget is active from the START OF ITS OWN-CADENCE PERIOD that contains its start
 *     date (a budget created mid-month owns that month's earlier purchases — its allocation covers
 *     the whole period), through `budget_end_date` (the user's end for a limited budget; the legacy
 *     `end_date` is only the first period's end) — or forever when ongoing.
 *   - Budgets of EVERY cadence own their categories in every lens (a weekly Groceries budget owns
 *     groceries in the monthly view too — as the period page counts it).
 *   - Everything Else is the structural fallback, one per lens.
 *
 * Source periods are calendar-exact (UTC): months; halves 1–15 / 16–end; weeks starting Sunday.
 *
 * PURE.
 *
 * @module domain/budgets/match_budgets
 */
import { BudgetForMatch, PeriodLens } from "../transactions/match_budget.service";
/** Start (ms) of the cadence period containing `ms` — same bounds as the source periods. */
export declare function period_start_ms(ms: number, cadence: PeriodLens): number;
/** A budget as the builder needs it (mapped from the entity by the caller). */
export interface BudgetForMatchInput {
    id: string;
    name: string;
    cadence: PeriodLens;
    category_ids: string[];
    start_ms: number;
    /** `budget_end_date` ?? `end_date` (ms); ignored when ongoing. */
    end_ms: number | null;
    is_ongoing: boolean;
    is_everything_else: boolean;
}
export interface MatchBudgets {
    real_budgets: BudgetForMatch[];
    everything_else_ids: Record<PeriodLens, string | null>;
    /** The monthly Everything Else, else any — the period page's single fallback. */
    primary_everything_else_id: string | null;
    /** Every Everything Else id (any lens): a manual pin to one means "Everything Else". */
    everything_else_id_set: ReadonlySet<string>;
    names: Record<string, string>;
}
export declare function build_match_budgets(budgets: BudgetForMatchInput[]): MatchBudgets;
/** The stored budget → the builder's input (the one place `budget_end_date ?? end_date` lives). */
export declare function budget_to_match_input(b: {
    id: string;
    name: string;
    period: string;
    category_ids?: string[];
    start_date: {
        toMillis(): number;
    };
    end_date?: {
        toMillis(): number;
    } | null;
    budget_end_date?: {
        toMillis(): number;
    } | null;
    is_ongoing: boolean;
    is_system_everything_else?: boolean;
}): BudgetForMatchInput;
//# sourceMappingURL=match_budgets.service.d.ts.map