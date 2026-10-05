/**
 * Occurrence dates — month-end and cadence coverage.
 *
 * `occurrence_dates_in_window` is the one date calculation behind live derive
 * (period page, Home, widgets) and the stored period generators. Before it,
 * monthly stepping used setUTCMonth(+1), which overflowed short months
 * (Jan 31 → Mar 3) and then kept the wrong day: a 31st bill showed due on the
 * 1st, a 30th bill on the 2nd. Each case below is one shape of that defect class.
 */

import { occurrence_dates_in_window } from "../outflow_period.service";

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
const days = (dates: Date[]) => dates.map((x) => x.toISOString().slice(0, 10));
const year_of = (anchor: Date, frequency: string, y: number) =>
  days(occurrence_dates_in_window(anchor, frequency, d(y, 1, 1), d(y, 12, 31)).dates);

describe("monthly on the 31st", () => {
  it("lands on the 31st or the month's last day, never the 1st", () => {
    expect(year_of(d(2025, 1, 31), "MONTHLY", 2025)).toEqual([
      "2025-01-31", "2025-02-28", "2025-03-31", "2025-04-30", "2025-05-31", "2025-06-30",
      "2025-07-31", "2025-08-31", "2025-09-30", "2025-10-31", "2025-11-30", "2025-12-31",
    ]);
  });

  it("is right in a single 31-day month window (was the 1st)", () => {
    const r = occurrence_dates_in_window(d(2025, 1, 31), "monthly", d(2025, 3, 1), d(2025, 3, 31));
    expect(days(r.dates)).toEqual(["2025-03-31"]);
  });

  it("uses Feb 29 in a leap year", () => {
    const r = occurrence_dates_in_window(d(2028, 1, 31), "MONTHLY", d(2028, 2, 1), d(2028, 2, 29));
    expect(days(r.dates)).toEqual(["2028-02-29"]);
  });

  it("works when anchored after the window (rewinding)", () => {
    const r = occurrence_dates_in_window(d(2026, 12, 31), "MONTHLY", d(2026, 4, 1), d(2026, 4, 30));
    expect(days(r.dates)).toEqual(["2026-04-30"]);
  });
});

describe("monthly on the 30th and 29th", () => {
  it("30th: Feb clamps, every other month is the 30th (was the 2nd)", () => {
    const got = year_of(d(2026, 3, 30), "MONTHLY", 2026);
    expect(got).toHaveLength(12);
    expect(got[1]).toBe("2026-02-28");
    expect(got.filter((x, i) => i !== 1).every((x) => x.endsWith("-30"))).toBe(true);
  });

  it("29th: only non-leap Feb clamps", () => {
    expect(year_of(d(2026, 1, 29), "MONTHLY", 2026)[1]).toBe("2026-02-28");
    expect(year_of(d(2028, 1, 29), "MONTHLY", 2028)[1]).toBe("2028-02-29");
  });

  it("an ordinary day (15th) is unchanged", () => {
    expect(year_of(d(2026, 1, 15), "MONTHLY", 2026).every((x) => x.endsWith("-15"))).toBe(true);
  });
});

describe("quarterly and yearly", () => {
  it("quarterly from Nov 30 keeps the 30th (Feb clamps)", () => {
    expect(year_of(d(2025, 11, 30), "QUARTERLY", 2026)).toEqual([
      "2026-02-28", "2026-05-30", "2026-08-30", "2026-11-30",
    ]);
  });

  it("yearly on Feb 29 falls on Feb 28 in non-leap years", () => {
    expect(year_of(d(2028, 2, 29), "yearly", 2026)).toEqual(["2026-02-28"]);
    expect(year_of(d(2028, 2, 29), "ANNUALLY", 2028)).toEqual(["2028-02-29"]);
  });
});

describe("next expected date", () => {
  it("is the next real due day after the window", () => {
    const r = occurrence_dates_in_window(d(2025, 1, 31), "MONTHLY", d(2025, 1, 1), d(2025, 1, 31));
    expect(r.next.toISOString().slice(0, 10)).toBe("2025-02-28");
  });
});

describe("day-based cadences are unchanged", () => {
  it("weekly: every 7 days, including ones before the anchor in the window", () => {
    const r = occurrence_dates_in_window(d(2026, 10, 15), "WEEKLY", d(2026, 10, 1), d(2026, 10, 31));
    expect(days(r.dates)).toEqual(["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"]);
  });

  it("bi-weekly: every 14 days", () => {
    const r = occurrence_dates_in_window(d(2026, 10, 2), "biweekly", d(2026, 10, 1), d(2026, 10, 31));
    expect(days(r.dates)).toEqual(["2026-10-02", "2026-10-16", "2026-10-30"]);
  });

  it("semi-monthly: two fixed days, the 15th and month-end", () => {
    const r = occurrence_dates_in_window(d(2026, 1, 15), "SEMI_MONTHLY", d(2026, 2, 1), d(2026, 2, 28));
    expect(days(r.dates)).toEqual(["2026-02-15", "2026-02-28"]);
  });
});
