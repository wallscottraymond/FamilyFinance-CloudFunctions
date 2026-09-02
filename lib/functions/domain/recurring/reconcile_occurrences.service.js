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
function reconcile_income_occurrences(recurring_id, payments, expected, window_start_ms, window_end_ms, opts = {}) {
    var _a;
    const tolerance_ms = ((_a = opts.tolerance_days) !== null && _a !== void 0 ? _a : DEFAULT_TOLERANCE_DAYS) * MS_PER_DAY;
    const out = [];
    const ordered = [...payments].sort((a, b) => a.date_ms - b.date_ms);
    const matched = new Set();
    // 1. Reconcile each expected occurrence against its closest unclaimed deposit.
    for (const e of expected) {
        let best_index = -1;
        let best_diff = Infinity;
        for (let i = 0; i < ordered.length; i++) {
            if (matched.has(i))
                continue;
            const diff = Math.abs(ordered[i].date_ms - e.due_date_ms);
            if (diff <= tolerance_ms && diff < best_diff) {
                best_diff = diff;
                best_index = i;
            }
        }
        if (best_index >= 0) {
            const p = ordered[best_index];
            matched.add(best_index);
            out.push({
                occurrence_id: e.occurrence_id,
                recurring_id,
                due_date_ms: e.due_date_ms,
                amount_due: e.amount_due,
                amount_paid: p.amount,
                is_paid: true,
                matched_transaction_id: p.transaction_id,
                matched_split_id: p.split_id,
                payment_date_ms: p.date_ms,
            });
        }
        else {
            out.push({
                occurrence_id: e.occurrence_id,
                recurring_id,
                due_date_ms: e.due_date_ms,
                amount_due: e.amount_due,
                amount_paid: 0,
                is_paid: false,
                matched_transaction_id: null,
                matched_split_id: null,
                payment_date_ms: null,
            });
        }
    }
    // 2. Deposits that matched NO expected occurrence → still shown as received (in-window),
    //    so variable/extra pay is never hidden.
    for (let i = 0; i < ordered.length; i++) {
        if (matched.has(i))
            continue;
        const p = ordered[i];
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
    return out;
}
//# sourceMappingURL=reconcile_occurrences.service.js.map