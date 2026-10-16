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
