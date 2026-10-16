import {
  apply_end_at,
  apply_remove,
  apply_restore,
  current_removal_state,
  is_payment_suppressed,
  is_suppressed_in_period,
  pending_end,
} from "../recurring_suppression.service";

const d = (iso: string) => Date.parse(iso);
const NOW = d("2026-10-15T12:00:00Z");
const OCT1 = d("2026-10-01T00:00:00Z");
const end_of = (iso: string) => d(iso) - 1;

describe("apply_end_at (It ended, X4)", () => {
  it("starts the month AFTER the last payment; past months keep the bill", () => {
    const last_sep = apply_end_at([], d("2026-09-05T00:00:00Z"), NOW, OCT1);
    expect(last_sep).toEqual([{ from_ms: OCT1, to_ms: null, mode: "going_forward" }]);
    expect(is_suppressed_in_period(last_sep, end_of("2026-10-01T00:00:00Z"))).toBe(false); // Sep shown
    expect(is_suppressed_in_period(last_sep, end_of("2026-11-01T00:00:00Z"))).toBe(true); // Oct gone
    expect(is_payment_suppressed(last_sep, d("2026-10-20T00:00:00Z"))).toBe(true); // Oct payment → budgets
  });

  it("a payment this month → ends next month (this month keeps it); never later than next month", () => {
    const last_oct = apply_end_at([], d("2026-10-05T00:00:00Z"), NOW, OCT1);
    const NOV1 = d("2026-11-01T00:00:00Z");
    expect(last_oct).toEqual([{ from_ms: NOV1, to_ms: null, mode: "going_forward" }]);
    expect(current_removal_state(last_oct, NOW).status).toBe("active"); // still this month's bill
    expect(pending_end(last_oct, NOW)?.from_ms).toBe(NOV1);
    expect(is_payment_suppressed(last_oct, d("2026-10-25T00:00:00Z"))).toBe(false);
    expect(is_payment_suppressed(last_oct, d("2026-11-03T00:00:00Z"))).toBe(true);
    // A bogus future "last payment" can't push the end past next month.
    expect(apply_end_at([], d("2027-03-01T00:00:00Z"), NOW, OCT1)[0].from_ms).toBe(NOV1);
  });

  it("no known payment → from this month (like going-forward remove)", () => {
    expect(apply_end_at([], null, NOW, OCT1)).toEqual(apply_remove([], "going_forward", NOW, OCT1));
  });

  it("supersedes an active pause; re-answering moves the pending end (never stacks)", () => {
    const paused = [{ from_ms: OCT1, to_ms: d("2026-12-01T00:00:00Z"), mode: "paused" as const }];
    const ended = apply_end_at(paused, d("2026-10-05T00:00:00Z"), NOW, OCT1);
    expect(ended[0].to_ms).toBe(NOW); // the pause closed at now
    const again = apply_end_at(ended, d("2026-10-05T00:00:00Z"), NOW, OCT1);
    expect(again.filter((i) => i.to_ms === null)).toHaveLength(1);
  });

  it("restore cancels a not-yet-started end outright, and closes a started one at now", () => {
    const future = apply_end_at([], d("2026-10-05T00:00:00Z"), NOW, OCT1);
    expect(apply_restore(future, NOW)).toEqual([]);
    const started = apply_end_at([], d("2026-09-05T00:00:00Z"), NOW, OCT1);
    expect(apply_restore(started, NOW)).toEqual([{ from_ms: OCT1, to_ms: NOW, mode: "going_forward" }]);
    // Existing intervals (no future starts) restore exactly as before.
    const removed = apply_remove([], "going_forward", NOW, OCT1);
    expect(apply_restore(removed, NOW)).toEqual([{ from_ms: OCT1, to_ms: NOW, mode: "going_forward" }]);
  });
});

describe("apply_end_at never shortens a suppression already in effect (review round 3 defect 5)", () => {
  const OCT5 = d("2026-10-05T00:00:00Z");
  const NOV1 = d("2026-11-01T00:00:00Z");
  const month_ok = (iv: Parameters<typeof is_payment_suppressed>[0]) => ({
    oct: is_payment_suppressed(iv, d("2026-10-20T00:00:00Z")),
    nov: is_payment_suppressed(iv, d("2026-11-20T00:00:00Z")),
    now: current_removal_state(iv!, NOW).status,
  });

  it("removed (all / going forward) right now → unchanged (the same array: a no-op)", () => {
    for (const mode of ["all", "going_forward"] as const) {
      const removed = apply_remove([], mode, NOW - 86400000, OCT1);
      const out = apply_end_at(removed, OCT5, NOW, OCT1); // paid this month: the old code ended from Nov 1
      expect(out).toBe(removed);
      expect(month_ok(out)).toEqual({ oct: true, nov: true, now: "removed" });
    }
  });

  it("paused right now (last payment this month) → the current month stays suppressed; never resumes", () => {
    const paused = [{ from_ms: OCT1, to_ms: d("2027-02-15T00:00:00Z"), mode: "paused" as const }];
    const out = apply_end_at(paused, OCT5, NOW, OCT1);
    expect(out).toEqual([
      { from_ms: OCT1, to_ms: NOW, mode: "paused" },
      { from_ms: OCT1, to_ms: null, mode: "going_forward" },
    ]);
    expect(month_ok(out)).toEqual({ oct: true, nov: true, now: "removed" });
    expect(is_payment_suppressed(out, d("2027-03-20T00:00:00Z"))).toBe(true); // the pause never resumes
    // Before the fix: the end started Nov 1 and the bill came back for the rest of October.
    expect(out.some((i) => i.from_ms === NOV1)).toBe(false);
  });

  it("nothing in effect → unchanged behavior (ends the month after the last payment)", () => {
    expect(apply_end_at([], OCT5, NOW, OCT1)).toEqual([{ from_ms: NOV1, to_ms: null, mode: "going_forward" }]);
    // A past, closed removal doesn't count as "in effect".
    const past = [{ from_ms: d("2026-06-01T00:00:00Z"), to_ms: d("2026-07-10T00:00:00Z"), mode: "going_forward" as const }];
    expect(apply_end_at(past, OCT5, NOW, OCT1)).toEqual([...past, { from_ms: NOV1, to_ms: null, mode: "going_forward" }]);
  });
});

describe("apply_end_at — UTC, leap and year edges (Top-25 #21)", () => {
  const AT = (y: number, m: number, d: number, h = 12, mi = 0) => Date.UTC(y, m - 1, d, h, mi);
  const NOV1 = AT(2026, 11, 1, 0);
  it("last payment Jan 31 → ends Feb 1 (UTC month start)", () => {
    const iv = apply_end_at([], AT(2040, 1, 31), AT(2040, 2, 10), AT(2040, 2, 1, 0));
    expect(iv).toEqual([{ from_ms: AT(2040, 2, 1, 0), to_ms: null, mode: "going_forward" }]);
  });
  it("last payment Feb 29 2040 (leap day) → ends Mar 1 2040", () => {
    const iv = apply_end_at([], AT(2040, 2, 29, 23, 59), AT(2040, 3, 5), AT(2040, 3, 1, 0));
    expect(iv[0].from_ms).toBe(AT(2040, 3, 1, 0));
    expect(is_payment_suppressed(iv, AT(2040, 2, 29, 23, 59))).toBe(false);
    expect(is_payment_suppressed(iv, AT(2040, 3, 1, 0, 1))).toBe(true);
  });
  it("last payment Dec 31 → ends Jan 1 of the NEXT year", () => {
    const iv = apply_end_at([], AT(2040, 12, 31, 18), AT(2041, 1, 3), AT(2041, 1, 1, 0));
    expect(iv[0].from_ms).toBe(AT(2041, 1, 1, 0));
    // The week straddling the year end (Sun Dec 30 2040 – Sat Jan 5 2041) keeps the Dec 31 payment.
    const week_end = AT(2040, 12, 30, 0) + 7 * 86400000 - 1;
    expect(is_suppressed_in_period(iv, week_end)).toBe(true);
    expect(is_payment_suppressed(iv, AT(2040, 12, 31, 18))).toBe(false);
    expect(is_payment_suppressed(iv, AT(2041, 1, 2))).toBe(true);
  });
  it("a payment at 23:30 local (UTC-7) on Oct 31 is stored as Nov 1 06:30Z → it is a NOVEMBER payment", () => {
    // Plaid dates are UTC-day based; the app counts days in UTC (CLAUDE.md "UTC-normalized day
    // counting"). So the end starts Dec 1, and November keeps the bill.
    const paid = AT(2026, 11, 1, 6, 30);
    const iv = apply_end_at([], paid, AT(2026, 11, 15), NOV1);
    expect(iv[0].from_ms).toBe(AT(2026, 12, 1, 0));
    expect(is_payment_suppressed(iv, paid)).toBe(false);
  });
  it("never later than next month: a payment dated after 'now' (clock skew) still ends next month", () => {
    const iv = apply_end_at([], AT(2027, 3, 1), NOW, OCT1);
    expect(iv[0].from_ms).toBe(d("2026-11-01T00:00:00Z"));
  });
});

