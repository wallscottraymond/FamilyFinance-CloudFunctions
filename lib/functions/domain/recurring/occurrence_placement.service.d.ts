/**
 * Occurrence Placement Domain Service
 *
 * Derive-On-Read Period Architecture — Phase 3 (bills + income).
 *
 * Bills (recurring outflows) and income (recurring inflows) can't be pure-summed
 * like budgets — each occurrence carries RECONCILIATION state (isPaid, matched
 * transaction, amountPaid) that is a fact about a real event. So instead of
 * materializing a period doc per cadence, we keep ONE canonical occurrence per
 * real event (on the item's own frequency) and PLACE it into whatever view
 * cadence on read: an occurrence lands in the single viewed bucket whose date
 * range contains its due date. The only thing that changes between cadences is
 * which time-bucket it falls in — never its amount or paid-status.
 *
 * This service is PURE: given the canonical occurrences + the view's buckets, it
 * places each occurrence and rolls the group up into the per-period fields the
 * client reads (counts, totals, status). No IO, no side effects, time as ms.
 *
 * Placement is identical for outflows and inflows, so this module is shared;
 * "paid" reads as "received" for income.
 *
 * @module domain/recurring/occurrence_placement
 */
/** A single canonical occurrence (one per real event, on the item's frequency). */
export interface CanonicalOccurrence {
    occurrence_id: string;
    /** The parent recurring item (outflow_id or inflow_id). */
    recurring_id: string;
    /** When this occurrence is due, epoch ms. */
    due_date_ms: number;
    amount_due: number;
    amount_paid: number;
    is_paid: boolean;
}
/** A view's calendar bucket (a monthly / weekly / bi-weekly source period). */
export interface PlacementBucket {
    period_id: string;
    /** Inclusive bucket bounds, epoch ms. */
    start_ms: number;
    end_ms: number;
}
/** Reconciliation status derived purely from the placed occurrences' paid state. */
export type OccurrenceReconStatus = "none" | "pending" | "partial" | "paid";
/** One view period's placed occurrences + reconciliation rollup. */
export interface PlacedOccurrenceGroup {
    period_id: string;
    occurrence_ids: string[];
    count_in_period: number;
    count_paid: number;
    count_unpaid: number;
    total_due: number;
    total_paid: number;
    total_unpaid: number;
    /** True if ANY occurrence is due in this period. */
    is_due_period: boolean;
    /** count > 0 AND every occurrence paid. */
    is_fully_paid: boolean;
    /** Some but not all paid. */
    is_partially_paid: boolean;
    status: OccurrenceReconStatus;
}
/**
 * Place canonical occurrences into a view's buckets and roll each group up.
 *
 * Buckets of a single cadence are non-overlapping, so each occurrence lands in
 * at most one; occurrences whose due date is outside every bucket are dropped
 * (out of the visible window).
 *
 * PURE FUNCTION.
 */
export declare function place_occurrences(occurrences: CanonicalOccurrence[], buckets: PlacementBucket[]): PlacedOccurrenceGroup[];
//# sourceMappingURL=occurrence_placement.service.d.ts.map