/**
 * Late Payment Domain Service — D31 (Convert-To-Recurring round 5, user-approved 2026-10-16).
 *
 * A bill's last occurrence before a removal / "It ended" / pause cut-off, paid a few days AFTER
 * the cut-off (due Sep 29, paid Oct 2, removed from Oct 1), counts as paying that bill — the
 * mirror of D28's early payment. Until now every payment in a removed / paused (UTC) month was
 * RELEASED (`is_payment_suppressed`): no bill link, ordinary spending; so that last bill read
 * unpaid while its payment counted as spending.
 *
 * The ONE release rule every reader applies — the assignment engine (the stored link), the period
 * page (derive), stored reconcile and the bill's transaction list — so the payment is counted
 * exactly once: as the bill's payment, never budget spend.
 *
 * Which occurrence a payment pays is the period page's matcher (`reconcile_occurrences`: the
 * nearest occurrence within 7 days, the earlier on a tie), judged from the bill's schedule.
 * BILLS only (income keeps today's release). PURE.
 *
 * @module domain/recurring/late_payment
 */
import { RecurringScheduleForGeneration } from "../outflows/outflow_period.service";
import { RemovalInterval } from "./recurring_suppression.service";
/** How late a payment may be (the matcher's tolerance — the same 7 days as D28's early carry). */
export declare const LATE_PAYMENT_MAX_MS: number;
/**
 * D31: the occurrence (in a month that ISN'T suppressed) that a payment made in a suppressed month
 * pays LATE — the matcher's nearest occurrence within 7 days, the earlier on a tie — or null when
 * the payment isn't such a late payment (its month isn't suppressed, or its nearest occurrence is
 * later than it, or in a suppressed month itself). `due_ms`: the bill's occurrences around the
 * payment (any order). PURE.
 */
export declare function late_paid_due_ms(intervals: RemovalInterval[] | undefined, due_ms: number[], payment_ms: number): number | null;
/** One of a bill's payments, as the release rule sees it (the reader's own payment list). */
export interface BillPaymentForRelease {
    /** The transaction (doc) id — breaks a same-day tie deterministically. */
    id: string;
    date_ms: number;
    /** Net amount paying the bill (a payment at or below a cent is no payment — page rule). */
    amount: number;
}
/** A bill as the release rule needs it: its schedule + every payment the reader holds for it. */
export interface BillForRelease {
    schedule: RecurringScheduleForGeneration;
    payments: BillPaymentForRelease[];
}
/** How far back of the late-paid occurrence the rule looks for its other payments (2 × 7 days:
 *  the occurrences before it and the payments that may claim them). Readers load that far. */
export declare const LATE_PAYMENT_LOOKBACK_MS: number;
/**
 * Is a payment RELEASED from a bill / income (it pays nothing; ordinary spending / money in)?
 * A payment in a removed / paused month is — except (D31, bills: pass the bill) a LATE payment
 * of the bill's last occurrence before the cut-off (`late_paid_due_ms`) that the occurrence is
 * still UNPAID for (D37): the period page's matcher (`reconcile_occurrences`, earliest payment
 * first, nearest unpaid occurrence within 7 days) run over that occurrence and the ones up to 14
 * days before it, with the bill's payments from 14 days before it up to this one — the payments in
 * a kept month and the other late payments of the same occurrence (every other payment in a
 * suppressed month is released) — gives the occurrence to THIS payment. So an extra / duplicate
 * charge after cancelling an already-paid bill, or a second late payment, is released (normal
 * spending, as before D31). Same-day ties: by transaction id. Income passes no bill: today's rule.
 * `bill.payments` may hold the payment itself (skipped by id). PURE.
 */
export declare function is_payment_released(intervals: RemovalInterval[] | undefined, payment: {
    id: string;
    date_ms: number;
}, bill?: BillForRelease | null): boolean;
/**
 * Could this payment be a bill's LATE payment (D31) — made in a suppressed month within 7 days
 * after the bill's last occurrence before the cut-off? Only then does the release rule need the
 * bill's other payments (`is_payment_released`), so a reader loads them only then. PURE.
 */
export declare function is_late_payment_candidate(intervals: RemovalInterval[] | undefined, payment_ms: number, schedule: RecurringScheduleForGeneration | null | undefined): boolean;
/** A bill's schedule as the period page builds it (the dates are what the release rule reads). */
export declare function bill_release_schedule(o: {
    frequency: string;
    average_amount: number;
    expected_amount_override?: number | null;
    first_date: RecurringScheduleForGeneration["first_date"];
    last_date: RecurringScheduleForGeneration["last_date"];
    predicted_next_date: RecurringScheduleForGeneration["predicted_next_date"];
    source?: string;
}): RecurringScheduleForGeneration;
//# sourceMappingURL=late_payment.service.d.ts.map