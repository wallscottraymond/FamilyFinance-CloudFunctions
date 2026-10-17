/**
 * Top-25 #3 — seeded property test on the derive (no new dependency: an inline mulberry32 PRNG).
 * Random bills (monthly / weekly / every 2 weeks / twice a month), random removal / pause / restore
 * intervals and random payments (made on their due day, some skipped, some extra-early by up to 2
 * days inside the same month). For EVERY cadence:
 *   - every payment is counted exactly once: a linked payment settles exactly one visible
 *     occurrence; a released payment (removed month) is Everything-Else spend, never paid;
 *   - per (UTC) month, the monthly view's paid / due equal the sum of that month's occurrences
 *     across the weekly buckets and across the twice-a-month buckets.
 * Engine routing (link vs release by the payment's month) is modelled by the fixture.
 *
 * D28 (round 4): payments may now be made EARLY across a month boundary — up to 6 days before
 * the due date (2 for weekly bills, so a payment never sits nearer the previous occurrence), into
 * the previous month, across removal / pause boundaries. A payment made in a KEPT month for an
 * occurrence due in a REMOVED month (due Oct 1, paid Sep 29, removed / ended from Oct 1) is paid
 * in the month it was made — counted exactly once, like every other payment.
 *
 * D31 (round 5): payments may also be LATE — up to 6 days after the due date (2 for weekly),
 * into the next month, across removal / pause / end boundaries. A payment made in a REMOVED month
 * that pays the last occurrence before the cut-off late (due Sep 29, paid Oct 2, removed from Oct
 * 1) is the bill's payment (not released, never Everything Else) — counted exactly once. The one
 * class still counted nowhere is enumerated and asserted explicitly (`resume_late`): a payment in
 * a KEPT month that pays LATE an occurrence due in a suppressed month (paused Sep → resumed Oct,
 * due Sep 29, paid Oct 1) — today's behavior, not covered by D28/D31 (a decision for the user).
 */
import { Timestamp } from "firebase-admin/firestore";
import { generate_expected_occurrences_in_window } from "../../outflows/outflow_period.service";
import { RemovalInterval, is_payment_suppressed } from "../../recurring/recurring_suppression.service";
import { BillSpec, Cadence, DAY, by_bucket, derive, is_released, payment_counts, round2, schedule_of } from "./derive_fixture";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WIN = { start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 11, 31, 23, 59, 59, 999) };
const FREQS = ["monthly", "weekly", "biweekly", "semimonthly"];

function randomBill(rnd: () => number, n: number): BillSpec {
  const frequency = FREQS[Math.floor(rnd() * FREQS.length)];
  const day = 1 + Math.floor(rnd() * 28);
  const anchor_ms = Date.UTC(2026, 5, day, 12);
  const amount = 10 + Math.floor(rnd() * 990);
  const intervals: RemovalInterval[] = [];
  for (let k = Math.floor(rnd() * 3); k > 0; k--) {
    const from_ms = WIN.start + Math.floor(rnd() * 330) * DAY + Math.floor(rnd() * 24) * 3600000;
    const open = rnd() < 0.35;
    intervals.push({
      from_ms: rnd() < 0.5 ? Date.UTC(new Date(from_ms).getUTCFullYear(), new Date(from_ms).getUTCMonth(), 1) : from_ms,
      to_ms: open ? null : from_ms + (1 + Math.floor(rnd() * 80)) * DAY,
      mode: open ? "going_forward" : "paused",
    });
  }
  const schedule = {
    frequency, average_amount: amount, first_date: Timestamp.fromMillis(Date.UTC(2025, 0, day, 12)),
    last_date: Timestamp.fromMillis(anchor_ms), predicted_next_date: Timestamp.fromMillis(anchor_ms),
  };
  const due = generate_expected_occurrences_in_window(schedule, WIN.start, WIN.end).map((g) => g.due_date_ms);
  const payments = due
    .filter(() => rnd() < 0.8)
    .map((ms, i) => {
      // Paid on the due day, EARLY (D28) or LATE (D31) — across month and removal boundaries — up
      // to 6 days (2 for weekly), never outside the window.
      const max_off = frequency === "weekly" ? 2 : 6;
      const off = Math.floor(rnd() * (max_off + 1)) * DAY * (rnd() < 0.5 ? -1 : 1);
      return { id: `b${n}_p${i}`, date_ms: Math.min(WIN.end, Math.max(WIN.start, ms + off)), amount };
    });
  return { id: `b${n}`, frequency, amount, anchor_ms, first_ms: Date.UTC(2025, 0, day, 12), removal_intervals: intervals, payments };
}

const SEEDS_D28 = Array.from({ length: 200 }, (_, i) => 1000 + i * 7919);

/** The matcher's occurrence for a payment on its own: the nearest within 7 days, earlier on a tie. */
function nearest_due(bill: BillSpec, pay_ms: number): number | null {
  const dues = generate_expected_occurrences_in_window(schedule_of(bill), pay_ms - 7 * DAY, pay_ms + 7 * DAY).map((g) => g.due_date_ms);
  let best: number | null = null;
  for (const d of dues.sort((a, b) => a - b)) if (best === null || Math.abs(pay_ms - d) < Math.abs(pay_ms - best)) best = d;
  return best;
}
/** The enumerated residual: a payment in a KEPT month paying LATE an occurrence of a suppressed month. */
const resume_late = (bill: BillSpec, pay_ms: number): boolean => {
  const d = nearest_due(bill, pay_ms);
  return d !== null && d < pay_ms && !is_payment_suppressed(bill.removal_intervals, pay_ms) &&
    is_payment_suppressed(bill.removal_intervals, d);
};

const month_key = (ms: number) => `${new Date(ms).getUTCFullYear()}-${new Date(ms).getUTCMonth()}`;

describe("derive property (seeded): counted exactly once; monthly == Σ sub-month buckets", () => {
  const SEEDS = SEEDS_D28;
  for (const seed of SEEDS) {
    it(`seed ${seed}`, () => {
      const rnd = mulberry32(seed);
      const bills = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, n) => randomBill(rnd, n));
      const per_month: Record<Cadence, Map<string, { paid: number; due: number }>> = {
        monthly: new Map(), weekly: new Map(), bi_monthly: new Map(),
      };
      for (const cadence of ["monthly", "weekly", "bi_monthly"] as Cadence[]) {
        const r = derive(bills, cadence, WIN);
        // 1. Every payment counted exactly once.
        const counts = payment_counts(r, bills);
        let released_total = 0;
        for (const bill of bills) {
          for (const p of bill.payments) {
            const released = is_released(bill, p.date_ms);
            if (released) released_total += p.amount;
            const n = released || resume_late(bill, p.date_ms) ? 0 : 1;
            expect({ cadence, p: p.id, n: counts.get(p.id) }).toEqual({ cadence, p: p.id, n });
          }
        }
        let ee = 0;
        for (const v of by_bucket(r, bills[0].id).values()) ee += v.ee;
        // Buckets are a partition of the window (weekly edges extend past it; no payment there).
        expect({ cadence, ee: round2(ee) }).toEqual({ cadence, ee: round2(released_total) });
        // 2. Per-month totals of the visible occurrences.
        for (const bill of r.bills) for (const g of bill.groups) for (const o of g.occurrences) {
          if (o.due_ms < WIN.start || o.due_ms > WIN.end) continue;
          const k = `${bill.recurring_id}:${month_key(o.due_ms)}`;
          const cur = per_month[cadence].get(k) ?? { paid: 0, due: 0 };
          cur.due = round2(cur.due + o.amount);
          if (o.paid) cur.paid = round2(cur.paid + o.amount);
          per_month[cadence].set(k, cur);
        }
      }
      const sorted = (m: Map<string, unknown>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
      expect(sorted(per_month.weekly)).toEqual(sorted(per_month.monthly));
      expect(sorted(per_month.bi_monthly)).toEqual(sorted(per_month.monthly));
    });
  }
});

describe("D28: a payment in a kept month for an occurrence due in a removed month is counted once", () => {
  it("the generator really produces the case (early payments across a removal / pause boundary)", () => {
    let hits = 0;
    for (const seed of SEEDS_D28) {
      const rnd = mulberry32(seed);
      const bills = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, n) => randomBill(rnd, n));
      for (const b of bills) for (const p of b.payments) {
        if (!is_payment_suppressed(b.removal_intervals, p.date_ms) &&
          b.removal_intervals.some(() => is_payment_suppressed(b.removal_intervals, p.date_ms + 6 * DAY))) hits++;
      }
    }
    expect(hits).toBeGreaterThan(0);
  });
});

describe("D31: a late payment of the last occurrence before a cut-off is counted once", () => {
  it("the generator really produces the case (late payments made in a removed / paused month)", () => {
    let hits = 0;
    let residual = 0;
    for (const seed of SEEDS_D28) {
      const rnd = mulberry32(seed);
      const bills = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, n) => randomBill(rnd, n));
      for (const b of bills) for (const p of b.payments) {
        if (is_payment_suppressed(b.removal_intervals, p.date_ms) && !is_released(b, p.date_ms)) hits++;
        if (resume_late(b, p.date_ms)) residual++;
      }
    }
    expect(hits).toBeGreaterThan(0);
    console.log(`[D31 generator] late-payment cases: ${hits}; enumerated resume_late residual: ${residual}`);
  });
});
