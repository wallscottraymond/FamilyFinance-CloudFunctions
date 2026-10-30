/**
 * Pure fixture for `compute_period_view` tests (review round 3): one bill + Everything Else, the
 * view buckets of a cadence, and each payment routed the way the assignment engine routes it — a
 * payment in a removed / paused (UTC) month is released (no bill link → Everything Else spend),
 * except (D31) a LATE payment of the bill's last occurrence before the cut-off; every other payment
 * is linked to the bill (excluded from budgets, settles an occurrence) — `is_payment_released`.
 * Not a test file (no `.test.`): helpers only.
 */
import { Timestamp } from "firebase-admin/firestore";
import { DerivePeriodResult } from "../period_view.service";
import { RemovalInterval } from "../../recurring/recurring_suppression.service";
export declare const DAY = 86400000;
export type Cadence = "monthly" | "weekly" | "bi_monthly";
export interface Bucket {
    period_id: string;
    start_ms: number;
    end_ms: number;
}
/** Monthly / Sun–Sat weekly / 1–15 + 16–end buckets covering [from, to). */
export declare function buckets(cadence: Cadence, from_ms: number, to_ms: number): Bucket[];
export interface BillSpec {
    id: string;
    frequency: string;
    amount: number;
    /** The schedule's anchor (its next predicted due date). */
    anchor_ms: number;
    first_ms: number;
    removal_intervals: RemovalInterval[];
    /** Payments (each a split): date + amount. */
    payments: Array<{
        id: string;
        date_ms: number;
        amount: number;
    }>;
}
/** The bill's schedule (as the period page builds it). */
export declare const schedule_of: (bill: BillSpec) => {
    frequency: string;
    average_amount: number;
    first_date: Timestamp;
    last_date: Timestamp;
    predicted_next_date: Timestamp;
};
/** The engine's routing: is this payment released from the bill (→ Everything Else)? Judged
 *  (D37) with every payment of the bill, as the engine / stored reconcile / the derive see them. */
export declare const is_released: (bill: BillSpec, p: {
    id: string;
    date_ms: number;
}) => boolean;
/**
 * `span_limited` models the period page's RESOLVER loading (D37): the matcher gets only the
 * payments inside the view's span, plus — the D31 late block — a payment up to 7 days past the
 * span made in a month suppressed for the bill that the release rule keeps; only the span's
 * payments are counted as spend. Without it every payment of the bill is passed (a whole-year view).
 */
export declare function derive(bills: BillSpec[], cadence: Cadence, window: {
    start: number;
    end: number;
}, opts?: {
    span_limited?: boolean;
}): DerivePeriodResult;
/** Per bucket: the bill's visible group (or null) + Everything Else spend. */
export declare function by_bucket(r: DerivePeriodResult, bill_id: string): Map<string, {
    group: DerivePeriodResult["bills"][0]["groups"][0] | null;
    ee: number;
}>;
/** Every payment's count across the view: as a paid occurrence (by transaction id) + as spend. */
export declare function payment_counts(r: DerivePeriodResult, bills: BillSpec[]): Map<string, number>;
export declare const round2: (n: number) => number;
//# sourceMappingURL=derive_fixture.d.ts.map