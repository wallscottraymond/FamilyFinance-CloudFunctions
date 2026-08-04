/**
 * Derive Recurring View Orchestrator
 *
 * Read-only coordination for the Derive-On-Read Period Architecture (Phase 3):
 * derive a bill/income (recurring outflow) view for a bounded window by running
 * the pure pipeline — generate expected occurrences FRESH from the schedule →
 * reconcile against actual payments → place into the viewed cadence's buckets.
 * Nothing is stored, so nothing can go stale.
 *
 * @module orchestrators/recurring/derive_recurring_view
 */
import { TraceContext } from "../../types";
import { RecurringKind } from "../../resolvers/recurring/recurring_view.resolver";
import { PlacedOccurrenceGroup } from "../../domain/recurring/occurrence_placement.service";
import { PeriodInstanceType } from "../../domain/budgets";
export interface DeriveRecurringViewInput {
    kind: RecurringKind;
    recurring_id: string;
    view_cadence: PeriodInstanceType;
    window_start_ms: number;
    window_end_ms: number;
}
export interface DeriveRecurringViewResult {
    kind: RecurringKind;
    recurring_id: string;
    name: string;
    view_cadence: PeriodInstanceType;
    groups: PlacedOccurrenceGroup[];
}
/**
 * Derive a recurring item's view for a window. Returns `null` when the outflow
 * doesn't exist or isn't owned by the caller (entry maps that to not-found).
 */
export declare function derive_recurring_view_orchestrator(ctx: TraceContext, user_id: string, input: DeriveRecurringViewInput): Promise<DeriveRecurringViewResult | null>;
//# sourceMappingURL=derive_recurring_view.orchestrator.d.ts.map