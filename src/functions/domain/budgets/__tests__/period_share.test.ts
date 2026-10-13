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
  it("quarterly / yearly / custom / unknown → the monthly rule", () => {
    for (const c of ["quarterly", "yearly", "custom", "QUARTERLY", "whatever"]) {
      expect(page_share(OCT[0], OCT[1], c)).toBeCloseTo(1, 9);
      expect(page_share(at("2031-10-05T00:00:00Z"), at("2031-10-11T23:59:59Z"), c))
        .toBeCloseTo(7 / 31, 9);
    }
  });
});
