import { page_share } from "../period_share.service";

const at = (iso: string): number => Date.parse(iso);
const OCT = [at("2031-10-01T00:00:00Z"), at("2031-10-31T23:59:59.999Z")] as const;

describe("page_share — a period's share of its budget under the PERIOD PAGE's rule (X10)", () => {
  it("the budget's own period is 1", () => {
    expect(page_share(OCT[0], OCT[1], "monthly")).toBeCloseTo(1, 9);
    expect(page_share(at("2031-10-05T00:00:00Z"), at("2031-10-11T23:59:59.999Z"), "weekly"))
      .toBeCloseTo(1, 9);
  });
  it("a week of a monthly budget in a 31-day month = 7/31; straddling two months", () => {
    expect(page_share(at("2031-10-05T00:00:00Z"), at("2031-10-11T23:59:59Z"), "monthly"))
      .toBeCloseTo(7 / 31, 9);
    expect(page_share(at("2031-09-28T00:00:00Z"), at("2031-10-04T23:59:59Z"), "monthly"))
      .toBeCloseTo(3 / 30 + 4 / 31, 9);
  });
  it("a month of a weekly budget = days / 7", () => {
    expect(page_share(OCT[0], OCT[1], "weekly")).toBeCloseTo(31 / 7, 9);
  });
  it("a bi_monthly half of a 31-day month = 2·15/31 or 2·16/31 (derive spreads the month)", () => {
    expect(page_share(at("2031-10-01T00:00:00Z"), at("2031-10-15T23:59:59Z"), "bi_monthly"))
      .toBeCloseTo((2 * 15) / 31, 9);
    expect(page_share(at("2031-10-16T00:00:00Z"), at("2031-10-31T23:59:59Z"), "bi_monthly"))
      .toBeCloseTo((2 * 16) / 31, 9);
    expect(page_share(OCT[0], OCT[1], "bi_monthly")).toBeCloseTo(2, 9);
  });
  it("quarterly / yearly → the monthly rule × a third / a twelfth (M1-H1)", () => {
    expect(page_share(OCT[0], OCT[1], "quarterly")).toBeCloseTo(1 / 3, 9);
    expect(page_share(OCT[0], OCT[1], "YEARLY")).toBeCloseTo(1 / 12, 9);
    expect(page_share(at("2031-10-05T00:00:00Z"), at("2031-10-11T23:59:59Z"), "yearly"))
      .toBeCloseTo(7 / 31 / 12, 9);
  });
  it("custom / unknown → the monthly rule", () => {
    for (const c of ["custom", "whatever"]) {
      expect(page_share(OCT[0], OCT[1], c)).toBeCloseTo(1, 9);
      expect(page_share(at("2031-10-05T00:00:00Z"), at("2031-10-11T23:59:59Z"), c))
        .toBeCloseTo(7 / 31, 9);
    }
  });

  // Code-Health-Review batch 6 verify #3 (Medium 1): the page spreads a PARTIAL month over its
  // priced days only (budget_priced_range), so the share must count those days the same way.
  describe("partial months (priced range)", () => {
    const JUN = [at("2026-06-01T00:00:00Z"), at("2026-06-30T23:59:59.999Z")] as const;
    it("weekly budget priced from Sun Jun 7: June = 24 priced days / 7, a June week = 1", () => {
      const priced = { from_ms: at("2026-06-07T00:00:00Z"), to_ms: null };
      expect(page_share(JUN[0], JUN[1], "weekly", priced)).toBeCloseTo(24 / 7, 9);
      expect(page_share(at("2026-06-07T00:00:00Z"), at("2026-06-13T23:59:59Z"), "weekly", priced))
        .toBeCloseTo(1, 9);
    });
    it("bi_monthly budget priced from Jun 16: June = one half (1), its B half = 1", () => {
      const priced = { from_ms: at("2026-06-16T00:00:00Z"), to_ms: null };
      expect(page_share(JUN[0], JUN[1], "bi_monthly", priced)).toBeCloseTo(1, 9);
      expect(page_share(at("2026-06-16T00:00:00Z"), JUN[1], "bi_monthly", priced)).toBeCloseTo(1, 9);
    });
    it("limited weekly budget priced to Sat Jun 13: June = 13 priced days / 7", () => {
      const priced = { from_ms: at("2026-05-31T00:00:00Z"), to_ms: at("2026-06-13T23:59:59.999Z") };
      expect(page_share(JUN[0], JUN[1], "weekly", priced)).toBeCloseTo(13 / 7, 9);
    });
    it("whole priced months match the no-range rule", () => {
      const priced = { from_ms: at("2020-01-01T00:00:00Z"), to_ms: null };
      for (const c of ["monthly", "weekly", "bi_monthly", "quarterly", "yearly"]) {
        expect(page_share(OCT[0], OCT[1], c, priced)).toBeCloseTo(page_share(OCT[0], OCT[1], c), 9);
      }
    });
  });
});
