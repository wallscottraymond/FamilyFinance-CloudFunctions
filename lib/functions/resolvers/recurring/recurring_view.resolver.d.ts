/**
 * Recurring View Resolver
 *
 * READ-ONLY dependency gathering for deriving a bill (recurring outflow) OR
 * income (recurring inflow) view on read (Derive-On-Read Period Architecture —
 * Phase 3). Both kinds share the schedule shape (frequency + anchor dates +
 * amount) and the same 3 pure primitives; only the repo + the split link field
 * differ. Fetches, bounded to the visible window:
 *   1. the item's SCHEDULE from its definition — the source of truth (the stored
 *      period docs are stale),
 *   2. the view's calendar buckets — `source_periods` of the requested cadence,
 *   3. the item's ACTUAL payments/receipts — transaction splits linked by
 *      `outflowId`/`inflowId` in the window.
 *
 * No generation/reconciliation/placement here (pure domain, run by the
 * orchestrator). No writes.
 *
 * @module resolvers/recurring/recurring_view
 */
import { TraceContext } from "../../types";
import { PeriodInstanceType } from "../../domain/budgets";
import { RecurringScheduleForGeneration } from "../../domain/outflows/outflow_period.service";
import { PlacementBucket } from "../../domain/recurring/occurrence_placement.service";
import { ActualPayment } from "../../domain/recurring/reconcile_occurrences.service";
/** Which recurring stream: a bill (outflow) or income (inflow). */
export type RecurringKind = "outflow" | "inflow";
/** Everything the recurring-view derivation needs, gathered read-only. */
export interface RecurringViewDeps {
    name: string;
    schedule: RecurringScheduleForGeneration;
    buckets: PlacementBucket[];
    payments: ActualPayment[];
    /** The union span of the buckets (generation + payment fetch range), epoch ms. */
    span_start_ms: number;
    span_end_ms: number;
}
/**
 * Gather the derivation inputs for `(kind, recurring_id, view_cadence, window)`.
 * Returns `null` when the item doesn't exist or isn't owned by the caller.
 */
export declare function resolve_recurring_view_deps(ctx: TraceContext, user_id: string, kind: RecurringKind, recurring_id: string, view_cadence: PeriodInstanceType, window_start_ms: number, window_end_ms: number): Promise<RecurringViewDeps | null>;
//# sourceMappingURL=recurring_view.resolver.d.ts.map