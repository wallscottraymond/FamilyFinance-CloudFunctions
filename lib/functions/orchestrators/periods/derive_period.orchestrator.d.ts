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
import { DerivePeriodResult } from "../../domain/periods/period_view.service";
export type { DerivedBudgetResult, DerivedRecurringResult, DerivePeriodResult, } from "../../domain/periods/period_view.service";
import { PeriodInstanceType } from "../../domain/budgets";
export interface DerivePeriodInput {
    view_cadence: PeriodInstanceType;
    window_start_ms: number;
    window_end_ms: number;
    /** Bypass the cached result and recompute fresh (still overwrites the cache with the result,
     *  stamped at the current version). Used by the FE right after a config mutation. */
    force?: boolean;
}
export declare function derive_period_orchestrator(ctx: TraceContext, user_id: string, input: DerivePeriodInput): Promise<DerivePeriodResult>;
//# sourceMappingURL=derive_period.orchestrator.d.ts.map