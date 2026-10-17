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

import {
  RecurringScheduleForGeneration,
  generate_expected_occurrences_in_window,
} from "../outflows/outflow_period.service";
import { RemovalInterval, is_payment_suppressed } from "./recurring_suppression.service";
import { reconcile_occurrences } from "./reconcile_occurrences.service";

/** How late a payment may be (the matcher's tolerance — the same 7 days as D28's early carry). */
export const LATE_PAYMENT_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * D31: the occurrence (in a month that ISN'T suppressed) that a payment made in a suppressed month
 * pays LATE — the matcher's nearest occurrence within 7 days, the earlier on a tie — or null when
 * the payment isn't such a late payment (its month isn't suppressed, or its nearest occurrence is
 * later than it, or in a suppressed month itself). `due_ms`: the bill's occurrences around the
 * payment (any order). PURE.
 */
export function late_paid_due_ms(
  intervals: RemovalInterval[] | undefined,
  due_ms: number[],
  payment_ms: number
): number | null {
  if (!intervals || intervals.length === 0 || !is_payment_suppressed(intervals, payment_ms)) return null;
  let best: number | null = null;
  let best_diff = Infinity;
  for (const d of [...due_ms].sort((a, b) => a - b)) {
    const diff = Math.abs(payment_ms - d);
    if (diff <= LATE_PAYMENT_MAX_MS && diff < best_diff) {
      best = d;
      best_diff = diff;
    }
  }
  if (best === null || best >= payment_ms || is_payment_suppressed(intervals, best)) return null;
  return best;
}

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
export const LATE_PAYMENT_LOOKBACK_MS = 2 * LATE_PAYMENT_MAX_MS;

const RELEASE_PAYMENT_EPSILON = 0.005;
const dues_near = (schedule: RecurringScheduleForGeneration, ms: number): number[] =>
  generate_expected_occurrences_in_window(schedule, ms - LATE_PAYMENT_MAX_MS, ms + LATE_PAYMENT_MAX_MS)
    .map((g) => g.due_date_ms);
const by_date_then_id = (a: BillPaymentForRelease, b: BillPaymentForRelease): number =>
  a.date_ms - b.date_ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

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
export function is_payment_released(
  intervals: RemovalInterval[] | undefined,
  payment: { id: string; date_ms: number },
  bill?: BillForRelease | null
): boolean {
  if (!is_payment_suppressed(intervals, payment.date_ms)) return false;
  if (!bill) return true;
  const due = late_paid_due_ms(intervals, dues_near(bill.schedule, payment.date_ms), payment.date_ms);
  if (due === null) return true;
  const lo = due - LATE_PAYMENT_LOOKBACK_MS;
  const self: BillPaymentForRelease = { id: payment.id, date_ms: payment.date_ms, amount: 1 };
  const competing = bill.payments.filter((q) =>
    q.id !== payment.id && q.amount > RELEASE_PAYMENT_EPSILON && q.date_ms >= lo &&
    by_date_then_id(q, self) < 0 &&
    (!is_payment_suppressed(intervals, q.date_ms) ||
      late_paid_due_ms(intervals, dues_near(bill.schedule, q.date_ms), q.date_ms) === due));
  const expected = generate_expected_occurrences_in_window(bill.schedule, lo, due)
    .map((g) => g.due_date_ms)
    .filter((d) => d <= due);
  if (!expected.includes(due)) expected.push(due);
  // The matcher's own order (earliest first) with the id tie-break: index order = that order.
  const ordered = [...competing, self].sort(by_date_then_id);
  const matched = reconcile_occurrences(
    expected.map((d) => ({ occurrence_id: String(d), recurring_id: "", due_date_ms: d, amount_due: 0 })),
    ordered.map((q, i) => ({ transaction_id: String(i), split_id: null, date_ms: q.date_ms, amount: q.amount }))
  );
  const own = String(ordered.indexOf(self));
  return matched.find((o) => o.due_date_ms === due)?.matched_transaction_id !== own;
}

/**
 * Could this payment be a bill's LATE payment (D31) — made in a suppressed month within 7 days
 * after the bill's last occurrence before the cut-off? Only then does the release rule need the
 * bill's other payments (`is_payment_released`), so a reader loads them only then. PURE.
 */
export function is_late_payment_candidate(
  intervals: RemovalInterval[] | undefined,
  payment_ms: number,
  schedule: RecurringScheduleForGeneration | null | undefined
): boolean {
  return !!schedule && is_payment_suppressed(intervals, payment_ms) &&
    late_paid_due_ms(intervals, dues_near(schedule, payment_ms), payment_ms) !== null;
}

/** A bill's schedule as the period page builds it (the dates are what the release rule reads). */
export function bill_release_schedule(o: {
  frequency: string;
  average_amount: number;
  expected_amount_override?: number | null;
  first_date: RecurringScheduleForGeneration["first_date"];
  last_date: RecurringScheduleForGeneration["last_date"];
  predicted_next_date: RecurringScheduleForGeneration["predicted_next_date"];
  source?: string;
}): RecurringScheduleForGeneration {
  return {
    frequency: o.frequency,
    average_amount: o.expected_amount_override ?? o.average_amount,
    first_date: o.first_date,
    last_date: o.last_date,
    predicted_next_date: o.predicted_next_date,
    source: o.source,
  };
}
