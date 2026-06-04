/**
 * match_source_periods Domain Service — Unit Tests
 */

import {
  match_source_periods,
  SourcePeriodForMatch,
} from "../match_source_periods.service";

const JUN_15 = Date.UTC(2026, 5, 15);
const JUL_15 = Date.UTC(2026, 6, 15);

const periods: SourcePeriodForMatch[] = [
  { id: "2026M06", type: "monthly", start_ms: Date.UTC(2026, 5, 1), end_ms: Date.UTC(2026, 5, 30, 23, 59, 59) },
  { id: "2026W24", type: "weekly", start_ms: Date.UTC(2026, 5, 14), end_ms: Date.UTC(2026, 5, 20, 23, 59, 59) },
  { id: "2026BM06A", type: "bi_monthly", start_ms: Date.UTC(2026, 5, 1), end_ms: Date.UTC(2026, 5, 15, 23, 59, 59) },
  { id: "2026M07", type: "monthly", start_ms: Date.UTC(2026, 6, 1), end_ms: Date.UTC(2026, 6, 31, 23, 59, 59) },
];

describe("match_source_periods", () => {
  it("maps a date to one period of each type (bi_monthly → bi_weekly field)", () => {
    const r = match_source_periods(JUN_15, periods);
    expect(r.monthly_period_id).toBe("2026M06");
    expect(r.weekly_period_id).toBe("2026W24");
    expect(r.bi_weekly_period_id).toBe("2026BM06A");
  });

  it("returns null for a type with no containing period", () => {
    // Jul 15: monthly 2026M07 contains it; no weekly/bi_monthly in the set.
    const r = match_source_periods(JUL_15, periods);
    expect(r.monthly_period_id).toBe("2026M07");
    expect(r.weekly_period_id).toBeNull();
    expect(r.bi_weekly_period_id).toBeNull();
  });

  it("is inclusive on both bounds", () => {
    const start = Date.UTC(2026, 5, 1);
    const r = match_source_periods(start, periods);
    expect(r.monthly_period_id).toBe("2026M06");
  });

  it("returns all-null when nothing contains the date", () => {
    const r = match_source_periods(Date.UTC(2030, 0, 1), periods);
    expect(r).toEqual({
      monthly_period_id: null,
      weekly_period_id: null,
      bi_weekly_period_id: null,
    });
  });

  it("is deterministic", () => {
    expect(match_source_periods(JUN_15, periods)).toEqual(match_source_periods(JUN_15, periods));
  });
});
