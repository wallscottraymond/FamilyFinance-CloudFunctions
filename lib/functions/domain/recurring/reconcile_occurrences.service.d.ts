/**
 * Reconcile Occurrences Domain Service
 *
 * Derive-On-Read Period Architecture — Phase 3 (bills + income).
 *
 * Given the freshly-generated EXPECTED occurrences for a recurring item (dueDate
 * + amountDue, computed from the item's definition — never stale) and the ACTUAL
 * payments (the stream's transactions / splits linked by `outflowId`/`inflowId`),
 * derive each occurrence's reconciliation state: which occurrence a payment
 * settled, the amount paid, and the payment date.
 *
 * This replaces reading the (stale, self-contradictory) materialized paid-state
 * off per-cadence period docs — paid-state is recomputed on read from the
 * canonical expected schedule + the real transactions, so it can't drift.
 *
 * Matching heuristic (mirrors the existing `findMatchingOccurrenceIndex`): each
 * payment settles the CLOSEST still-unpaid occurrence within a day tolerance;
 * payments are applied earliest-first so earlier payments claim earlier
 * occurrences. PURE: no IO, time as ms.
 *
 * Shared by outflows + inflows ("paid" = "received" for income). Output is a
 * `CanonicalOccurrence` superset, so it flows directly into `place_occurrences`.
 *
 * @module domain/recurring/reconcile_occurrences
 */
import { CanonicalOccurrence } from "./occurrence_placement.service";
/** An expected occurrence from the schedule (before reconciliation). */
export interface ExpectedOccurrence {
    occurrence_id: string;
    recurring_id: string;
    due_date_ms: number;
    amount_due: number;
}
/** An actual payment linked to the recurring item. */
export interface ActualPayment {
    transaction_id: string;
    split_id: string | null;
    date_ms: number;
    amount: number;
}
/** A reconciled occurrence: canonical + which payment settled it. */
export interface ReconciledOccurrence extends CanonicalOccurrence {
    matched_transaction_id: string | null;
    matched_split_id: string | null;
    payment_date_ms: number | null;
}
/**
 * Reconcile expected occurrences against actual payments.
 *
 * @param expected  - The item's expected occurrences (from schedule generation)
 * @param payments  - The item's actual payments (linked transactions/splits)
 * @param opts.tolerance_days - Max |payment − dueDate| to match (default 7)
 *
 * PURE FUNCTION.
 */
export declare function reconcile_occurrences(expected: ExpectedOccurrence[], payments: ActualPayment[], opts?: {
    tolerance_days?: number;
}): ReconciledOccurrence[];
/**
 * Reconcile INCOME against its schedule-generated EXPECTED occurrences + ACTUAL deposits.
 *
 * Derive-On-Read-Regression-Audit (S3/S4): income previously projected ONLY the single
 * `predicted_next_date`, so a semi-monthly payer showed 1 receipt instead of 2 (S4) and
 * any month AFTER predicted_next showed NO income at all (S3 — e.g. October empty). Income
 * now mirrors the bill path: the caller generates EXPECTED occurrences from the schedule
 * (frequency + anchor), and here we reconcile the ACTUAL linked deposits (Plaid stream
 * `transaction_ids`) against them:
 *   - an expected occurrence with a deposit within tolerance → received (ACTUAL amount+date),
 *   - an expected occurrence with no deposit → OUTSTANDING (expected amount),
 *   - a deposit matching no expected occurrence → still shown as received (variable/extra pay;
 *     income receipts are authoritative), so nothing real is ever hidden.
 *
 * Same output shape as `reconcile_occurrences` so placement is unchanged. PURE.
 *
 * NOTE: outstanding (not-yet-received) occurrences carry the schedule's average amount;
 * per-occurrence amount history (e.g. a semi-monthly payer's differing mid/end checks) is a
 * later refinement — received ones already use the actual deposit amount.
 *
 * @param recurring_id  - The inflow id
 * @param payments      - The inflow's actual linked deposits
 * @param expected      - Expected occurrences generated from the schedule (in-window)
 * @param window_start_ms/window_end_ms - The derivation window (bounds the extra deposits)
 */
export declare function reconcile_income_occurrences(recurring_id: string, payments: ActualPayment[], expected: ExpectedOccurrence[], window_start_ms: number, window_end_ms: number, opts?: {
    tolerance_days?: number;
}): ReconciledOccurrence[];
//# sourceMappingURL=reconcile_occurrences.service.d.ts.map