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
  it("monthly due the 29th: Oct 2 kept (late), Oct 9 released; income (no schedule) always released", () => {
    const s = sched("monthly", "2026-11-29");
    expect(is_payment_released(iv, D("2026-10-02"), s)).toBe(false);
    expect(is_payment_released(iv, D("2026-10-09"), s)).toBe(true);
    expect(is_payment_released(iv, D("2026-10-02"))).toBe(true);
    expect(is_payment_released(iv, D("2026-09-20"), s)).toBe(false); // not a suppressed month at all
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
