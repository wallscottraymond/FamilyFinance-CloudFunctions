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

