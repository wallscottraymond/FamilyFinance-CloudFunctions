/**
 * estimate_slot_amounts — Unit Tests
 *
 * Per-occurrence-day income amount estimation from history (semi-monthly mid vs end).
 */

import { estimate_slot_amounts } from "../income_slot_amounts";

const d = (y: number, m: number, day: number, amount: number) => ({
  date_ms: Date.UTC(y, m, day),
  amount,
});

describe("estimate_slot_amounts", () => {
  it("estimates each occurrence day from the deposits nearest it (mid vs end differ)", () => {
    const deposits = [
      d(2026, 4, 15, 3000), d(2026, 4, 30, 18000),
      d(2026, 5, 15, 3200), d(2026, 5, 30, 20000),
      d(2026, 6, 14, 3358), d(2026, 6, 30, 15000),
    ];
    const slots = estimate_slot_amounts([15, 30], deposits);
    expect(slots.get(15)).toBeCloseTo((3000 + 3200 + 3358) / 3, 2);
    expect(slots.get(30)).toBeCloseTo((18000 + 20000 + 15000) / 3, 2);
    // The two slots are clearly different sizes.
    expect(slots.get(30)! - slots.get(15)!).toBeGreaterThan(10000);
  });

  it("averages only the most-recent N per slot", () => {
    const deposits = [
      d(2026, 0, 15, 1000), // old — should drop out of a last-2 window
      d(2026, 1, 15, 3000),
      d(2026, 2, 15, 3400),
    ];
    const slots = estimate_slot_amounts([15, 30], deposits, 2);
    expect(slots.get(15)).toBeCloseTo((3000 + 3400) / 2, 2); // 1000 excluded
  });

  it("returns empty for a single occurrence day (nothing to differentiate)", () => {
    const slots = estimate_slot_amounts([15], [d(2026, 4, 15, 3000)]);
    expect(slots.size).toBe(0);
  });

  it("returns no amount for a slot with no deposits (caller falls back to average)", () => {
    const slots = estimate_slot_amounts([15, 30], [d(2026, 4, 15, 3000)]);
    expect(slots.get(15)).toBeCloseTo(3000, 2);
    expect(slots.has(30)).toBe(false);
  });

  it("slots an off-day deposit to the nearest occurrence day (circular)", () => {
    // A deposit on the 2nd is nearest the 30th (circular distance 3) not the 15th (13).
    const slots = estimate_slot_amounts([15, 30], [d(2026, 4, 2, 9999), d(2026, 4, 16, 3000)]);
    expect(slots.get(30)).toBeCloseTo(9999, 2);
    expect(slots.get(15)).toBeCloseTo(3000, 2);
  });
});
