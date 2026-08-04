"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcile_occurrences = reconcile_occurrences;
exports.reconcile_income_occurrences = reconcile_income_occurrences;
const DEFAULT_TOLERANCE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/**
 * Reconcile expected occurrences against actual payments.
 *
 * @param expected  - The item's expected occurrences (from schedule generation)
 * @param payments  - The item's actual payments (linked transactions/splits)
 * @param opts.tolerance_days - Max |payment − dueDate| to match (default 7)
 *
 * PURE FUNCTION.
 */
function reconcile_occurrences(expected, payments, opts = {}) {
    var _a;
    const tolerance_ms = ((_a = opts.tolerance_days) !== null && _a !== void 0 ? _a : DEFAULT_TOLERANCE_DAYS) * MS_PER_DAY;
    // Start every occurrence unpaid.
    const reconciled = expected.map((e) => ({
        occurrence_id: e.occurrence_id,
        recurring_id: e.recurring_id,
        due_date_ms: e.due_date_ms,
        amount_due: e.amount_due,
        amount_paid: 0,
        is_paid: false,
        matched_transaction_id: null,
        matched_split_id: null,
        payment_date_ms: null,
    }));
    // Apply payments earliest-first so earlier payments claim earlier occurrences.
    const ordered = [...payments].sort((a, b) => a.date_ms - b.date_ms);
    for (const payment of ordered) {
        let best_index = -1;
        let best_diff = Infinity;
        for (let i = 0; i < reconciled.length; i++) {
            const occ = reconciled[i];
            if (occ.is_paid) {
                continue;
            }
            const diff = Math.abs(payment.date_ms - occ.due_date_ms);
            if (diff <= tolerance_ms && diff < best_diff) {
                best_diff = diff;
                best_index = i;
            }
        }
        if (best_index >= 0) {
            const occ = reconciled[best_index];
            occ.is_paid = true;
            occ.amount_paid = payment.amount;
            occ.matched_transaction_id = payment.transaction_id;
            occ.matched_split_id = payment.split_id;
            occ.payment_date_ms = payment.date_ms;
        }
        // Payments matching no occurrence within tolerance are left unreconciled
        // (advance/extra/one-off); surfacing those is a later refinement.
    }
    return reconciled;
}
/**
 * Reconcile INCOME from its ACTUAL transactions (Income-Tracking-Audit).
 *
 * Plaid gives us the exact deposits that compose a recurring income stream (via
 * its `transaction_ids`), so we do NOT synthesize historical occurrences for
 * income (which mis-counts variable/semimonthly pay). Instead:
 *   - each linked deposit in the window IS a received (paid) occurrence, and
 *   - the single `predicted_next_date` is projected as ONE outstanding occurrence
 *     when it falls in the window and hasn't already been received.
 *
 * Same output shape as `reconcile_occurrences` so placement is unchanged. PURE.
 *
 * @param recurring_id            - The inflow id
 * @param payments               - The inflow's actual linked deposits
 * @param predicted_next_date_ms - Next expected receipt (from the stream), or null
 * @param average_amount         - Expected amount for the projected outstanding one
 * @param window_start_ms/window_end_ms - The derivation window
 */
function reconcile_income_occurrences(recurring_id, payments, predicted_next_date_ms, average_amount, window_start_ms, window_end_ms, opts = {}) {
    var _a;
    const tolerance_ms = ((_a = opts.tolerance_days) !== null && _a !== void 0 ? _a : DEFAULT_TOLERANCE_DAYS) * MS_PER_DAY;
    const out = [];
    // 1. Each actual linked deposit in the window = a received (paid) occurrence.
    for (const p of payments) {
        if (p.date_ms < window_start_ms || p.date_ms > window_end_ms)
            continue;
        out.push({
            occurrence_id: `${recurring_id}_${p.date_ms}`,
            recurring_id,
            due_date_ms: p.date_ms,
            amount_due: p.amount,
            amount_paid: p.amount,
            is_paid: true,
            matched_transaction_id: p.transaction_id,
            matched_split_id: p.split_id,
            payment_date_ms: p.date_ms,
        });
    }
    // 2. Project the next expected receipt as OUTSTANDING when it's in the window
    //    and not already covered by a received deposit.
    if (predicted_next_date_ms != null &&
        predicted_next_date_ms >= window_start_ms &&
        predicted_next_date_ms <= window_end_ms &&
        !payments.some((p) => Math.abs(p.date_ms - predicted_next_date_ms) <= tolerance_ms)) {
        out.push({
            occurrence_id: `${recurring_id}_next_${predicted_next_date_ms}`,
            recurring_id,
            due_date_ms: predicted_next_date_ms,
            amount_due: average_amount,
            amount_paid: 0,
            is_paid: false,
            matched_transaction_id: null,
            matched_split_id: null,
            payment_date_ms: null,
        });
    }
    return out;
}
//# sourceMappingURL=reconcile_occurrences.service.js.map