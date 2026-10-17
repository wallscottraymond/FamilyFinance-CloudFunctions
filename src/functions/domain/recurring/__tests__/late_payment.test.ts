/**
 * D31 (round 5): the ONE release rule — a payment in a removed / paused month is released, except
 * a bill's LATE payment of its last occurrence before the cut-off (the matcher's nearest within 7
 * days, the earlier on a tie). PURE.
 */
import { Timestamp } from "firebase-admin/firestore";
import { generate_expected_occurrences_in_window } from "../../outflows/outflow_period.service";
import { is_payment_released, late_paid_due_ms } from "../late_payment.service";
import type { RemovalInterval } from "../recurring_suppression.service";

const D = (s: string, h = 12) => Date.parse(`${s}T${String(h).padStart(2, "0")}:00:00Z`);
const DAY = 86400000;
const iv: RemovalInterval[] = [{ from_ms: Date.UTC(2026, 9, 1), to_ms: null, mode: "going_forward" }];
const sched = (frequency: string, anchor: string) => ({
  frequency, average_amount: 10, first_date: Timestamp.fromMillis(D("2025-01-05")),
  last_date: Timestamp.fromMillis(D(anchor)), predicted_next_date: Timestamp.fromMillis(D(anchor)),
});

describe("late_paid_due_ms", () => {
  it("nearest kept occurrence before a payment in a suppressed month; null otherwise", () => {
    expect(late_paid_due_ms(iv, [D("2026-09-29", 0), D("2026-10-29", 0)], D("2026-10-02"))).toBe(D("2026-09-29", 0));
    expect(late_paid_due_ms(iv, [D("2026-09-29", 0)], D("2026-09-30"))).toBeNull(); // its month isn't suppressed
    expect(late_paid_due_ms(iv, [D("2026-09-29", 0), D("2026-10-03", 0)], D("2026-10-02"))).toBeNull(); // nearer: a removed one
    expect(late_paid_due_ms(iv, [D("2026-09-24", 0)], D("2026-10-02"))).toBeNull(); // > 7 days
    expect(late_paid_due_ms(iv, [D("2026-09-28", 12), D("2026-10-06", 12)], D("2026-10-02", 12))).toBe(D("2026-09-28", 12)); // tie → earlier
    expect(late_paid_due_ms([], [D("2026-09-29", 0)], D("2026-10-02"))).toBeNull();
  });
});

describe("is_payment_released", () => {
  const P = (id: string, day: string, amount = 10) => ({ id, date_ms: D(day), amount });
  const bill = (s: ReturnType<typeof sched>, payments: ReturnType<typeof P>[]) => ({ schedule: s, payments });
  it("monthly due the 29th: Oct 2 kept (late), Oct 9 released; income (no bill) always released", () => {
    const s = sched("monthly", "2026-11-29");
    expect(is_payment_released(iv, P("oct2", "2026-10-02"), bill(s, []))).toBe(false);
    expect(is_payment_released(iv, P("oct9", "2026-10-09"), bill(s, []))).toBe(true);
    expect(is_payment_released(iv, P("oct2", "2026-10-02"))).toBe(true);
    expect(is_payment_released(iv, P("sep20", "2026-09-20"), bill(s, []))).toBe(false); // not a suppressed month at all
  });

  it("D37: only while the occurrence is still unpaid — an extra charge or a second late payment is released", () => {
    const s = sched("monthly", "2026-11-29");
    // Paid on time Sep 29, then an extra charge Oct 2 → released (normal spending, as before D31).
    const on_time = [P("sep29", "2026-09-29"), P("oct2", "2026-10-02")];
    expect(is_payment_released(iv, P("oct2", "2026-10-02"), bill(s, on_time))).toBe(true);
    // Paid early Sep 25 (within 7 days) → Sep 29 is paid; Oct 2 released.
    expect(is_payment_released(iv, P("oct2", "2026-10-02"), bill(s, [P("sep25", "2026-09-25"), P("oct2", "2026-10-02")]))).toBe(true);
    // Two late payments: the first pays it, the second is spending.
    const two_late = [P("oct1", "2026-10-01"), P("oct3", "2026-10-03")];
    expect(is_payment_released(iv, P("oct1", "2026-10-01"), bill(s, two_late))).toBe(false);
    expect(is_payment_released(iv, P("oct3", "2026-10-03"), bill(s, two_late))).toBe(true);
    // Same day: the lower transaction id pays it.
    const same_day = [P("b", "2026-10-02"), P("a", "2026-10-02")];
    expect(is_payment_released(iv, P("a", "2026-10-02"), bill(s, same_day))).toBe(false);
    expect(is_payment_released(iv, P("b", "2026-10-02"), bill(s, same_day))).toBe(true);
    // A payment at or below a cent isn't one; an older payment (Aug 29, the previous occurrence) isn't either.
    expect(is_payment_released(iv, P("oct2", "2026-10-02"), bill(s, [P("tiny", "2026-09-29", 0.004), P("aug29", "2026-08-29")]))).toBe(false);
    // A released charge (Oct 9: > 7 days) doesn't take the occurrence from a later late payment's rule.
    expect(is_payment_released(iv, P("oct2", "2026-10-02"), bill(s, [P("oct2", "2026-10-02")]))).toBe(false);
  });

  it("D37 weekly: a kept-month payment that the matcher gives an EARLIER occurrence doesn't pay the last one", () => {
    // Weekly on Wednesdays: Sep 16, 23, 30 (kept); Oct 7 removed. Sep 22 pays Sep 23, Sep 29 pays Sep 30 → Oct 2 released.
    const s = sched("weekly", "2026-10-14");
    const paid = [P("s22", "2026-09-22"), P("s29", "2026-09-29"), P("o2", "2026-10-02")];
    expect(is_payment_released(iv, P("o2", "2026-10-02"), bill(s, paid))).toBe(true);
    // Sep 23 paid on Sep 22, Sep 30 unpaid → Oct 2 pays Sep 30.
    expect(is_payment_released(iv, P("o2", "2026-10-02"), bill(s, [P("s22", "2026-09-22"), P("o2", "2026-10-02")]))).toBe(false);
  });

  it("the ±7-day window generates the same occurrences as a wide window (every frequency)", () => {
    for (const [f, a] of [["monthly", "2026-11-29"], ["weekly", "2026-10-13"], ["biweekly", "2026-10-13"], ["semimonthly", "2026-10-15"]]) {
      const s = sched(f, a);
      const wide = generate_expected_occurrences_in_window(s, D("2026-08-01", 0), D("2026-12-31", 0)).map((g) => g.due_date_ms);
      for (let p = D("2026-09-01"); p < D("2026-11-30"); p += DAY) {
        const narrow = generate_expected_occurrences_in_window(s, p - 7 * DAY, p + 7 * DAY).map((g) => g.due_date_ms);
        expect({ f, p, narrow }).toEqual({ f, p, narrow: wide.filter((d) => d >= p - 7 * DAY && d <= p + 7 * DAY) });
      }
    }
  });
});
