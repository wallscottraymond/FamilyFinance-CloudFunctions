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

/**
 * Is a payment RELEASED from a bill / income (it pays nothing; ordinary spending / money in)?
 * A payment in a removed / paused month is — except (D31, bills: pass the bill's `schedule`) a
 * LATE payment of the bill's last occurrence before the cut-off (`late_paid_due_ms`). Income
 * passes no schedule: today's rule. PURE.
 */
export function is_payment_released(
  intervals: RemovalInterval[] | undefined,
  payment_ms: number,
  schedule?: RecurringScheduleForGeneration | null
): boolean {
  if (!is_payment_suppressed(intervals, payment_ms)) return false;
  if (!schedule) return true;
  const dues = generate_expected_occurrences_in_window(
    schedule,
    payment_ms - LATE_PAYMENT_MAX_MS,
    payment_ms + LATE_PAYMENT_MAX_MS
  ).map((g) => g.due_date_ms);
  return late_paid_due_ms(intervals, dues, payment_ms) === null;
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
