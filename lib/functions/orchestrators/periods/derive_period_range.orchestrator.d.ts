/**
 * Derive Period RANGE Orchestrator (read-only)
 *
 * Derives MANY period windows of one cadence in a single call (the Home preload: the last 12
 * periods), plus each window's goals view. Per window the result is IDENTICAL to
 * `derive_period` + `derive_goals_view` for that window — same shaping
 * (`shape_period_derivation_deps`), same pure computation (`compute_period_view`,
 * `build_goals_view`) — but the user's definitions + the transactions for the whole range are read
 * ONCE instead of once per window.
 *
 * Shares `derive_period`'s per-window L2 cache (same keys, version-stamped): windows served from
 * the cache skip computation; only the misses are loaded + derived, and their results are written
 * back so a later single-window `derive_period` hits too.
 *
 * @module orchestrators/periods/derive_period_range
 */
import { TraceContext } from "../../types";
import { DerivePeriodResult } from "../../domain/periods/period_view.service";
import { DeriveGoalsViewResult } from "../../domain/goals/goals_view.service";
import { PeriodInstanceType } from "../../domain/budgets";
export interface DeriveRangeWindow {
    period_id: string;
    start_ms: number;
    end_ms: number;
}
export interface DerivePeriodRangeInput {
    view_cadence: PeriodInstanceType;
    windows: DeriveRangeWindow[];
    /** Bypass cached results (recompute every window, still writing the cache). */
    force?: boolean;
}
export interface DerivePeriodRangeWindowResult {
    period_id: string;
    start_ms: number;
    end_ms: number;
    derive: DerivePeriodResult;
    /** Null only if the period_id isn't a real source period in the range. */
    goals: DeriveGoalsViewResult | null;
    from_cache: boolean;
}
export interface DerivePeriodRangeResult {
    view_cadence: PeriodInstanceType;
    windows: DerivePeriodRangeWindowResult[];
}
export declare function derive_period_range_orchestrator(ctx: TraceContext, user_id: string, input: DerivePeriodRangeInput): Promise<DerivePeriodRangeResult>;
//# sourceMappingURL=derive_period_range.orchestrator.d.ts.map