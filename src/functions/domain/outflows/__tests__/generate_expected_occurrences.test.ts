/**
 * generate_expected_occurrences_in_window — Unit Tests
 *
 * Verifies fresh occurrence generation from a recurring schedule + window
 * (the read-time replacement for stale materialized period docs). Reuses the
 * proven cycle/stepping logic; here we assert the windowed output.
 */

import { Timestamp } from "firebase-admin/firestore";
import {
  generate_expected_occurrences_in_window,
  RecurringScheduleForGeneration,
} from "../outflow_period.service";

const ts = (y: number, m: number, d: number) => Timestamp.fromMillis(Date.UTC(y, m, d));

function monthly(over: Partial<RecurringScheduleForGeneration> = {}): RecurringScheduleForGeneration {
  return {
    frequency: "MONTHLY",
    average_amount: 89.4,
    first_date: ts(2025, 0, 15),
    last_date: ts(2026, 0, 15), // anchor: the 15th
    predicted_next_date: null,
    ...over,
  };
}

describe("generate_expected_occurrences_in_window", () => {
  it("generates one monthly occurrence per month in the window (on the anchor day)", () => {
    // Window: Feb–Apr 2026 → expect occurrences ~Feb 15, Mar 15, Apr 15.
    const occs = generate_expected_occurrences_in_window(
      monthly(),
      Date.UTC(2026, 1, 1),
      Date.UTC(2026, 3, 30, 23, 59, 59)
    );
    expect(occs.length).toBe(3);
    for (const o of occs) {
      // ~the 15th; the reused stepping logic is local-time based, so the exact
      // UTC day can shift ±1 by machine timezone (a pre-existing quirk of the
      // existing generator — inherited intentionally, not introduced here).
      const dom = new Date(o.due_date_ms).getUTCDate();
      expect(dom).toBeGreaterThanOrEqual(14);
      expect(dom).toBeLessThanOrEqual(15);
      expect(o.amount_due).toBe(89.4);
    }
    // Consecutive occurrences ~1 month apart.
    for (let i = 1; i < occs.length; i++) {
      // Round to absorb DST hour-shifts in the local-time-stepped dates.
      const gapDays = Math.round(
        (occs[i].due_date_ms - occs[i - 1].due_date_ms) / (24 * 60 * 60 * 1000)
      );
      expect(gapDays).toBeGreaterThanOrEqual(28);
      expect(gapDays).toBeLessThanOrEqual(31);
    }
  });

  it("generates weekly occurrences for a weekly schedule", () => {
    const weekly: RecurringScheduleForGeneration = {
      frequency: "WEEKLY",
      average_amount: 20,
      first_date: ts(2026, 0, 1),
      last_date: ts(2026, 5, 4), // a Thursday anchor
      predicted_next_date: null,
    };
    // A 4-week window should hold ~4 weekly occurrences.
    const occs = generate_expected_occurrences_in_window(
      weekly,
      Date.UTC(2026, 5, 1),
      Date.UTC(2026, 5, 28, 23, 59, 59)
    );
    expect(occs.length).toBeGreaterThanOrEqual(4);
    expect(occs.length).toBeLessThanOrEqual(5);
    expect(occs.every((o) => o.amount_due === 20)).toBe(true);
  });

  it("returns no occurrences when the window is before the schedule pattern hits", () => {
    // Monthly on the 15th; a window entirely on days 1–10 yields none.
    const occs = generate_expected_occurrences_in_window(
      monthly(),
      Date.UTC(2026, 1, 1),
      Date.UTC(2026, 1, 10, 23, 59, 59)
    );
    expect(occs.length).toBe(0);
  });
});
