/**
 * D27 — stored periods follow the derive's month rule (`is_stored_period_active`).
 * Cases (a)–(c) from review round 3, the monthly equivalence (monthly periods unchanged), and a
 * seeded property check against the derive's own visibility rule.
 */
import {
  RemovalInterval,
  is_payment_suppressed,
  is_stored_period_active,
  is_suppressed_in_period,
  resnap_period_decision,
  stored_occurrence_due_ms,
} from "../recurring_suppression.service";

const U = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h);
const week_end = (y: number, m: number, d: number) => U(y, m, d) + 7 * 86400000 - 1; // week starting y-m-d
const ts = (ms: number) => ({ toMillis: () => ms });

/** The derive's visibility rule for a bucket (period_view.service, b6a8281). */
const derive_visible = (iv: RemovalInterval[], end_ms: number, due: number[]) =>
  !is_suppressed_in_period(iv, end_ms) || due.some((ms) => !is_payment_suppressed(iv, ms));

describe("is_stored_period_active (D27)", () => {
  it("(a) a week straddling a removal start keeps a payment made before it", () => {
    const iv: RemovalInterval[] = [{ from_ms: U(2026, 10, 1), to_ms: null, mode: "going_forward" }];
    const end = week_end(2026, 9, 27); // Sun Sep 27 – Sat Oct 3
    expect(is_suppressed_in_period(iv, end)).toBe(true); // the old whole-period rule hid it
    expect(is_stored_period_active(iv, end, [U(2026, 9, 29)])).toBe(true);
    expect(is_stored_period_active(iv, end, [U(2026, 10, 2)])).toBe(false); // occurrence in the removed month
    expect(is_stored_period_active(iv, end, [])).toBe(false);
  });

  it("(b) the restore month before the restore day is active where it has an occurrence", () => {
    const iv: RemovalInterval[] = [{ from_ms: U(2026, 9, 1), to_ms: U(2026, 10, 20), mode: "going_forward" }];
    const end = week_end(2026, 10, 11); // Oct 11–17, ends before the restore day
    expect(is_suppressed_in_period(iv, end)).toBe(true);
    expect(is_stored_period_active(iv, end, [U(2026, 10, 12)])).toBe(true);
    expect(is_stored_period_active(iv, end, [])).toBe(false); // no occurrence → still hidden
    // Twice a month: Oct 1–15 (restored after the 15th) with its occurrence.
    expect(is_stored_period_active(iv, U(2026, 10, 16) - 1, [U(2026, 10, 12)])).toBe(true);
    // September (fully removed) stays inactive.
    expect(is_stored_period_active(iv, U(2026, 10, 1) - 1, [U(2026, 9, 12)])).toBe(false);
  });

  it("(c) a restore early in a month: the straddling week is active (listed, its Sep occurrence dropped by the derive)", () => {
    const iv: RemovalInterval[] = [{ from_ms: U(2026, 9, 1), to_ms: U(2026, 10, 2), mode: "paused" }];
    const end = week_end(2026, 9, 27); // ends Oct 3 > Oct 2 → not suppressed as a whole
    expect(is_stored_period_active(iv, end, [U(2026, 9, 29)])).toBe(true);
    expect(is_payment_suppressed(iv, U(2026, 9, 29))).toBe(true);
  });

  it("monthly periods are unchanged; no intervals → always active", () => {
    expect(is_stored_period_active([], 0, [])).toBe(true);
    expect(is_stored_period_active(undefined, 0, [])).toBe(true);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let n = 0; n < 2000; n++) {
      const a = U(2026, 1 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28));
      const iv: RemovalInterval[] = [{ from_ms: a, to_ms: rnd() < 0.5 ? null : a + Math.floor(rnd() * 120) * 86400000, mode: "going_forward" }];
      const m = 1 + Math.floor(rnd() * 12);
      const end = U(2026, m + 1, 1) - 1;
      const due = rnd() < 0.3 ? [] : [U(2026, m, 1 + Math.floor(rnd() * 28))];
      // A month with an occurrence: identical to the whole-period rule.
      if (due.length) expect(is_stored_period_active(iv, end, due)).toBe(!is_suppressed_in_period(iv, end));
    }
  });

  it("property (seeded): equals the derive's bucket visibility for random weeks / halves / intervals", () => {
    let seed = 20261016;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let n = 0; n < 5000; n++) {
      const start = U(2026, 1, 1) + Math.floor(rnd() * 365) * 86400000;
      const len = [7, 14, 15][Math.floor(rnd() * 3)];
      const end = start + len * 86400000 - 1;
      const iv: RemovalInterval[] = [];
      for (let k = Math.floor(rnd() * 3); k > 0; k--) {
        const f = U(2026, 1, 1) + Math.floor(rnd() * 400) * 86400000;
        iv.push({ from_ms: f, to_ms: rnd() < 0.4 ? null : f + Math.floor(rnd() * 90) * 86400000, mode: "paused" });
      }
      const due = Array.from({ length: Math.floor(rnd() * 3) }, () => start + Math.floor(rnd() * len) * 86400000);
      expect(is_stored_period_active(iv, end, due)).toBe(iv.length === 0 ? true : derive_visible(iv, end, due));
    }
  });

  it("stored_occurrence_due_ms reads the parallel array or the occurrence objects", () => {
    expect(stored_occurrence_due_ms({ occurrenceDueDates: [ts(5), ts(9)] })).toEqual([5, 9]);
    expect(stored_occurrence_due_ms({ occurrences: [{ dueDate: ts(3) }, { dueDate: null }] })).toEqual([3]);
    expect(stored_occurrence_due_ms({ occurrenceDueDates: [ts(3)], occurrences: [{ dueDate: ts(3) }] })).toEqual([3]);
    expect(stored_occurrence_due_ms({})).toEqual([]);
  });
});

describe("round 4 defect 4 — the re-snap's scope (resnap_period_decision)", () => {
  const removed: RemovalInterval[] = [{ from_ms: U(2037, 10, 1), to_ms: null, mode: "going_forward" }];
  const straddle_end = week_end(2037, 9, 27);
  it("flips only a period still in the OLD rule's state where the month rule differs", () => {
    // Straddling week, stored inactive (old rule) with a Sep 29 occurrence → flip to active.
    expect(resnap_period_decision(removed, straddle_end, [U(2037, 9, 29)], false)).toEqual({ flip: true, next_active: true, in_window_active: false });
    // Same week already active (corrected, or never suppressed) → nothing.
    expect(resnap_period_decision(removed, straddle_end, [U(2037, 9, 29)], true).flip).toBe(false);
  });
  it("a period inactive for another reason (both rules say active) is left alone", () => {
    expect(resnap_period_decision(removed, U(2037, 9, 1) - 1, [U(2037, 8, 29)], false)).toEqual({ flip: false, next_active: true, in_window_active: false });
  });
  it("active inside the window (both rules inactive) → not flipped, reported", () => {
    expect(resnap_period_decision(removed, U(2037, 11, 1) - 1, [U(2037, 10, 29)], true)).toEqual({ flip: false, next_active: false, in_window_active: true });
  });
  it("no intervals → never flips", () => {
    expect(resnap_period_decision([], straddle_end, [], false)).toEqual({ flip: false, next_active: true, in_window_active: false });
  });
});
