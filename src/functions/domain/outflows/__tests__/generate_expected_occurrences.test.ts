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

  // Regression (S2 — Derive-On-Read-Regression-Audit): a "yearly" bill was normalized
  // to "YEARLY", missed the "ANNUALLY" case, and fell through to the monthly default —
  // so it generated an occurrence EVERY month and appeared in every future period.
  const yearly: RecurringScheduleForGeneration = {
    frequency: "yearly", // lowercase app spelling — the exact value that broke
    average_amount: 193.41,
    first_date: ts(2026, 4, 18),
    last_date: ts(2026, 4, 18), // anchor: May 18
    predicted_next_date: null,
  };

  it("generates a yearly bill only in its anniversary month, not every month", () => {
    // September window → NONE (it's due in May).
    const sep = generate_expected_occurrences_in_window(
      yearly,
      Date.UTC(2026, 8, 1),
      Date.UTC(2026, 8, 30, 23, 59, 59)
    );
    expect(sep.length).toBe(0);
    // May window → exactly one.
    const may = generate_expected_occurrences_in_window(
      yearly,
      Date.UTC(2027, 4, 1),
      Date.UTC(2027, 4, 31, 23, 59, 59)
    );
    expect(may.length).toBe(1);
    expect(new Date(may[0].due_date_ms).getUTCMonth()).toBe(4); // May
  });

  // #4 (Derive-On-Read-Regression-Audit): semi-monthly is two FIXED days/month, not a
  // drifting +15-day chain that emitted a phantom 3rd occurrence in some months.
  const semimonthly = (anchorDay: number): RecurringScheduleForGeneration => ({
    frequency: "semimonthly",
    average_amount: 1000,
    first_date: ts(2026, 0, anchorDay),
    last_date: ts(2026, 8, anchorDay), // anchor in September
    predicted_next_date: ts(2026, 8, anchorDay),
  });

  it("semi-monthly generates exactly TWO occurrences per month on fixed days (anchor 15th → 15 & 30)", () => {
    const occs = generate_expected_occurrences_in_window(
      semimonthly(15),
      Date.UTC(2026, 8, 1),
      Date.UTC(2026, 8, 30, 23, 59, 59)
    );
    const days = occs.map((o) => new Date(o.due_date_ms).getUTCDate());
    expect(days).toEqual([15, 30]);
  });

  it("semi-monthly does NOT drift across months (Nov stays 15 & 30, not 14 & 29)", () => {
    const occs = generate_expected_occurrences_in_window(
      semimonthly(15),
      Date.UTC(2026, 10, 1),
      Date.UTC(2026, 10, 30, 23, 59, 59)
    );
    expect(occs.map((o) => new Date(o.due_date_ms).getUTCDate())).toEqual([15, 30]);
  });

  it("semi-monthly with a mid/late anchor (24th) → days 9 & 24; exactly two, no phantom", () => {
    const occs = generate_expected_occurrences_in_window(
      semimonthly(24),
      Date.UTC(2026, 8, 1),
      Date.UTC(2026, 8, 30, 23, 59, 59)
    );
    expect(occs.map((o) => new Date(o.due_date_ms).getUTCDate())).toEqual([9, 24]);
  });

  it("generation is timezone-independent (UTC day-math) — one monthly occurrence, same UTC day", () => {
    // The anchor is UTC midnight on the 1st (a month-boundary day, most TZ-sensitive).
    const monthly_first = monthly({ last_date: ts(2026, 0, 1), predicted_next_date: null });
    const occs = generate_expected_occurrences_in_window(
      monthly_first,
      Date.UTC(2026, 5, 1),
      Date.UTC(2026, 5, 30, 23, 59, 59)
    );
    expect(occs).toHaveLength(1);
    expect(new Date(occs[0].due_date_ms).getUTCDate()).toBe(1); // the 1st, not shifted to the 31st
  });

  it("does NOT fan out an unknown frequency across every month (steps yearly, not monthly)", () => {
    const unknown: RecurringScheduleForGeneration = { ...yearly, frequency: "GIBBERISH" };
    // A 3-month window would hold 3 occurrences if it fell back to monthly; expect 0–1.
    const occs = generate_expected_occurrences_in_window(
      unknown,
      Date.UTC(2026, 6, 1),
      Date.UTC(2026, 8, 30, 23, 59, 59)
    );
    expect(occs.length).toBeLessThanOrEqual(1);
  });
});
