/**
 * Pure fixture for `compute_period_view` tests (review round 3): one bill + Everything Else, the
 * view buckets of a cadence, and each payment routed the way the assignment engine routes it — a
 * payment in a removed / paused (UTC) month is released (no bill link → Everything Else spend),
 * every other payment is linked to the bill (excluded from budgets, settles an occurrence).
 * Not a test file (no `.test.`): helpers only.
 */
import { Timestamp } from "firebase-admin/firestore";
import { compute_period_view, DerivePeriodResult } from "../period_view.service";
import { PeriodDerivationDeps } from "../period_derivation.types";
import { RemovalInterval, is_payment_suppressed } from "../../recurring/recurring_suppression.service";

export const DAY = 86400000;
export type Cadence = "monthly" | "weekly" | "bi_monthly";

export interface Bucket { period_id: string; start_ms: number; end_ms: number }

/** Monthly / Sun–Sat weekly / 1–15 + 16–end buckets covering [from, to). */
export function buckets(cadence: Cadence, from_ms: number, to_ms: number): Bucket[] {
  const out: Bucket[] = [];
  const d0 = new Date(from_ms);
  if (cadence === "monthly") {
    for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth(); Date.UTC(y, m, 1) < to_ms; m++) {
      out.push({ period_id: `M_${y}_${m}`, start_ms: Date.UTC(y, m, 1), end_ms: Date.UTC(y, m + 1, 1) - 1 });
    }
  } else if (cadence === "bi_monthly") {
    for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth(); Date.UTC(y, m, 1) < to_ms; m++) {
      out.push({ period_id: `BM_${y}_${m}_A`, start_ms: Date.UTC(y, m, 1), end_ms: Date.UTC(y, m, 16) - 1 });
      out.push({ period_id: `BM_${y}_${m}_B`, start_ms: Date.UTC(y, m, 16), end_ms: Date.UTC(y, m + 1, 1) - 1 });
    }
  } else {
    const start = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) - d0.getUTCDay() * DAY;
    for (let s = start; s < to_ms; s += 7 * DAY) out.push({ period_id: `W_${s}`, start_ms: s, end_ms: s + 7 * DAY - 1 });
  }
  return out;
}

export interface BillSpec {
  id: string;
  frequency: string; // "monthly" | "weekly" | "biweekly" | "semimonthly"
  amount: number;
  /** The schedule's anchor (its next predicted due date). */
  anchor_ms: number;
  first_ms: number;
  removal_intervals: RemovalInterval[];
  /** Payments (each a split): date + amount. */
  payments: Array<{ id: string; date_ms: number; amount: number }>;
}

export function derive(bills: BillSpec[], cadence: Cadence, window: { start: number; end: number }): DerivePeriodResult {
  const b = buckets(cadence, window.start, window.end + 1);
  const deps: PeriodDerivationDeps = {
    view_buckets: b.map((x) => ({ ...x, period_type: cadence })),
    placement_buckets: b,
    budgets: [{ id: "ee", name: "Everything Else", is_ee: true, monthly_periods: [], active_start_ms: 0, active_end_ms: null }],
    real_budgets: [],
    monthly_ee_id: "ee",
    any_ee_id: "ee",
    splits_for_match: bills.flatMap((bill) => bill.payments.map((p) => {
      const released = is_payment_suppressed(bill.removal_intervals, p.date_ms);
      return {
        amount: p.amount, txn_date_ms: p.date_ms, is_pending: false, is_transfer: false, is_income: false,
        spend_status: "counted" as const, outflow_id: released ? null : bill.id, inflow_id: null,
        first_category_id: null, semantic_code: "RENT_AND_UTILITIES_RENT", manual_pin_budget_id: null,
      };
    })),
    recurring: bills.map((bill) => ({
      id: bill.id,
      name: bill.id,
      kind: "outflow" as const,
      schedule: {
        frequency: bill.frequency, average_amount: bill.amount, first_date: Timestamp.fromMillis(bill.first_ms),
        last_date: Timestamp.fromMillis(bill.anchor_ms), predicted_next_date: Timestamp.fromMillis(bill.anchor_ms),
      },
      payments: bill.payments
        .filter((p) => !is_payment_suppressed(bill.removal_intervals, p.date_ms))
        .map((p) => ({ transaction_id: p.id, split_id: null, date_ms: p.date_ms, amount: p.amount })),
      removal_intervals: bill.removal_intervals,
    })),
    goals: [],
    other_income_credits: [],
    span_start_ms: b[0].start_ms,
    span_end_ms: b[b.length - 1].end_ms,
  };
  return compute_period_view(deps, cadence);
}

/** Per bucket: the bill's visible group (or null) + Everything Else spend. */
export function by_bucket(r: DerivePeriodResult, bill_id: string): Map<string, { group: DerivePeriodResult["bills"][0]["groups"][0] | null; ee: number }> {
  const out = new Map<string, { group: DerivePeriodResult["bills"][0]["groups"][0] | null; ee: number }>();
  const ee = r.budgets.find((x) => x.is_everything_else)!;
  for (const p of ee.periods) out.set(p.period_id, { group: null, ee: p.spent });
  for (const g of r.bills.find((x) => x.recurring_id === bill_id)?.groups ?? []) {
    out.set(g.period_id, { ...(out.get(g.period_id) ?? { ee: 0 }), group: g });
  }
  return out;
}

/** Every payment's count across the view: as a paid occurrence (by transaction id) + as spend. */
export function payment_counts(r: DerivePeriodResult, bills: BillSpec[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const bill of bills) for (const p of bill.payments) counts.set(p.id, 0);
  for (const bill of r.bills) for (const g of bill.groups) for (const o of g.occurrences) {
    if (o.paid && o.transaction_id) counts.set(o.transaction_id, (counts.get(o.transaction_id) ?? 0) + 1);
  }
  return counts;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
