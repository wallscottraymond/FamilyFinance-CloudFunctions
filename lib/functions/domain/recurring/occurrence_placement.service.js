"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.place_occurrences = place_occurrences;
/** UTC day index (days since epoch) for a timestamp. PURE. */
function utc_day_index(ms) {
    const d = new Date(ms);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
}
/** Whether a due date falls within a bucket, compared at UTC-day resolution. PURE. */
function in_bucket(due_ms, bucket) {
    const day = utc_day_index(due_ms);
    return day >= utc_day_index(bucket.start_ms) && day <= utc_day_index(bucket.end_ms);
}
/** Round to 2 decimals. PURE. */
function round2(value) {
    return Math.round(value * 100) / 100;
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
function place_occurrences(occurrences, buckets) {
    return buckets.map((bucket) => {
        const placed = occurrences.filter((o) => in_bucket(o.due_date_ms, bucket));
        let total_due = 0;
        let total_paid = 0;
        let count_paid = 0;
        const occurrence_ids = [];
        for (const o of placed) {
            occurrence_ids.push(o.occurrence_id);
            total_due += o.amount_due;
            total_paid += o.amount_paid;
            if (o.is_paid) {
                count_paid++;
            }
        }
        const count_in_period = placed.length;
        const count_unpaid = count_in_period - count_paid;
        const is_due_period = count_in_period > 0;
        const is_fully_paid = is_due_period && count_unpaid === 0;
        const is_partially_paid = count_paid > 0 && count_unpaid > 0;
        const status = !is_due_period
            ? "none"
            : is_fully_paid
                ? "paid"
                : count_paid > 0
                    ? "partial"
                    : "pending";
        return {
            period_id: bucket.period_id,
            occurrence_ids,
            count_in_period,
            count_paid,
            count_unpaid,
            total_due: round2(total_due),
            total_paid: round2(total_paid),
            total_unpaid: round2(total_due - total_paid),
            is_due_period,
            is_fully_paid,
            is_partially_paid,
            status,
        };
    });
}
//# sourceMappingURL=occurrence_placement.service.js.map