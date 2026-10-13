import { budget_share_of_period } from "../period_share.service";

const at = (iso: string): number => Date.parse(iso);

describe("budget_share_of_period — a period's normal share of a budget (X10)", () => {
  it("the budget's own period is 1", () => {
    expect(budget_share_of_period(at("2031-10-01T00:00:00Z"), at("2031-10-31T23:59:59.999Z"), "monthly")).toBeCloseTo(1, 9);
    expect(budget_share_of_period(at("2031-10-05T00:00:00Z"), at("2031-10-11T23:59:59.999Z"), "weekly")).toBeCloseTo(1, 9);
    expect(budget_share_of_period(at("2031-02-16T00:00:00Z"), at("2031-02-28T23:59:59.999Z"), "bi_monthly")).toBeCloseTo(1, 9);
  });
  it("a week of a monthly budget, incl. one straddling two months", () => {
    expect(budget_share_of_period(at("2031-10-05T00:00:00Z"), at("2031-10-11T23:59:59Z"), "monthly")).toBeCloseTo(7 / 31, 9);
    expect(budget_share_of_period(at("2031-09-28T00:00:00Z"), at("2031-10-04T23:59:59Z"), "monthly")).toBeCloseTo(3 / 30 + 4 / 31, 9);
  });
  it("a month of a weekly budget is days / 7 (no matter how weeks fall)", () => {
    expect(budget_share_of_period(at("2031-10-01T00:00:00Z"), at("2031-10-31T23:59:59Z"), "weekly")).toBeCloseTo(31 / 7, 9);
  });
  it("a month of a twice-a-month budget is 2", () => {
    expect(budget_share_of_period(at("2031-02-01T00:00:00Z"), at("2031-02-28T23:59:59Z"), "bi_monthly")).toBeCloseTo(2, 9);
  });
  it("an unknown cadence → null", () => {
    expect(budget_share_of_period(at("2031-10-01T00:00:00Z"), at("2031-10-07T00:00:00Z"), "yearly")).toBeNull();
  });
});
