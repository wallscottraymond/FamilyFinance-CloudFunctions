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
import { budget_repo, outflow_repo, inflow_repo, SourcePeriodEntity } from "../../repositories";
import { budget_period_repo } from "../../repositories/budget_period.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import { goal_repo } from "../../repositories/goal.repo";
import { PeriodInstanceType } from "../../domain/budgets";
export type { BudgetForDerivation, RecurringForDerivation, PeriodDerivationDeps, } from "../../domain/periods/period_derivation.types";
import type { PeriodDerivationDeps } from "../../domain/periods/period_derivation.types";
type Awaited2<T> = T extends Promise<infer U> ? U : T;
/**
 * Everything Firestore returns for one OR MORE windows of a cadence — the IO half of period
 * derivation. Loaded once (`load_period_derivation_raw`) and re-filtered per window in memory
 * (`shape_period_derivation_deps`), so a multi-window derive reads the user's definitions and
 * transactions ONCE instead of per window.
 */
export interface PeriodDerivationRaw {
    /** `get_overlapping` result for [min window start, max window end] (ordered by startDate). */
    overlapping: SourcePeriodEntity[];
    budget_entities: Awaited2<ReturnType<typeof budget_repo.get_by_user_id>>;
    monthly_period_docs: Awaited2<ReturnType<typeof budget_period_repo.get_by_user_and_type>>;
    outflows: Awaited2<ReturnType<typeof outflow_repo.get_by_user_id>>;
    inflows: Awaited2<ReturnType<typeof inflow_repo.get_by_user_id>>;
    all_goals: Awaited2<ReturnType<typeof goal_repo.get_by_user>>;
    /** Active transactions across the UNION of every window's derivation span. */
    txns: Array<{
        id: string;
        data: Record<string, unknown>;
    }>;
    /** Historical deposits for a SUPERSET of every window's inflow stream ids. */
    inflow_history_docs: Awaited2<ReturnType<typeof transaction_repo.get_by_plaid_transaction_ids>>;
}
export interface DerivationWindow {
    start_ms: number;
    end_ms: number;
}
/**
 * `periodStart` bounds for the monthly budget periods derivation can use for [range_start,
 * range_end] (Read-Cost-Review-Round-3 #5). `shape_period_derivation_deps` keeps only periods
 * overlapping a window's span; a span is built from source periods overlapping the range, so it
 * lies within [range_start − 31d, range_end + 31d], and a kept period (≤ 31d long) must START in
 * [range_start − 62d, range_end + 31d]. Loading exactly that superset leaves the shaped result
 * IDENTICAL to loading all of the user's monthly periods (incl. the "no stored period → synthesize"
 * fallback, which already looks only at span-overlapping periods).
 */
export declare function monthly_period_load_bounds(range_start_ms: number, range_end_ms: number): [number, number];
export declare function load_period_derivation_raw(ctx: TraceContext, user_id: string, view_cadence: PeriodInstanceType, windows: DerivationWindow[]): Promise<PeriodDerivationRaw>;
/**
 * Lookup/shaping half (NO IO): build ONE window's derivation inputs from a raw load, applying the
 * same predicates the per-window queries apply — so the result is identical to loading that
 * window alone.
 */
export declare function shape_period_derivation_deps(raw: PeriodDerivationRaw, view_cadence: PeriodInstanceType, window_start_ms: number, window_end_ms: number): PeriodDerivationDeps;
/**
 * Load + shape for a SINGLE window — the `derive_period` path. Identical output to deriving any
 * window of a multi-window load (see `derive_period_range`).
 */
export declare function resolve_period_derivation_deps(ctx: TraceContext, user_id: string, view_cadence: PeriodInstanceType, window_start_ms: number, window_end_ms: number): Promise<PeriodDerivationDeps>;
//# sourceMappingURL=period_derivation.resolver.d.ts.map