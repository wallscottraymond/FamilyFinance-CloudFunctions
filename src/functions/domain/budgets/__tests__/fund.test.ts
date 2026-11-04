import { build_self_provision_budget_created_payload } from "../period_generation.service";
import { fund_forward_share, fund_month_count, fund_monthly_share, fund_position } from "../fund.service";

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

describe("fund_month_count", () => {
  it("counts the calendar months touched", () => {
    expect(fund_month_count(D(2026, 10, 1), D(2026, 12, 31))).toBe(3);
    expect(fund_month_count(D(2026, 10, 31), D(2026, 12, 1))).toBe(3);
    expect(fund_month_count(D(2026, 12, 1), D(2026, 12, 25))).toBe(1);
    expect(fund_month_count(D(2026, 11, 15), D(2027, 2, 2))).toBe(4);
  });
});

describe("fund_monthly_share", () => {
  it("is the total over the months", () => {
    expect(fund_monthly_share(300, D(2026, 10, 1), D(2026, 12, 31))).toBe(100);
    expect(fund_monthly_share(100, D(2026, 10, 1), D(2026, 12, 31))).toBe(33.33);
  });
});

describe("fund_forward_share", () => {
  it("spreads what's still to set aside over the months left", () => {
    expect(fund_forward_share(600, [100], 2)).toBe(250);
  });
  it("is zero when the total drops below what's already set aside", () => {
    expect(fund_forward_share(50, [100], 2)).toBe(0);
  });
});

describe("fund_position", () => {
  it("is what's left, below zero when over", () => {
    expect(fund_position(300, 100).left).toBe(200);
    expect(fund_position(300, 340.5).left).toBe(-40.5);
  });
});

describe("the heal job's payload", () => {
  const args = {
    budget_id: "f", user_id: "u", group_ids: [], budget_name: "Trip", category_ids: [], amount: 300,
    period: "monthly", start: new Date(D(2026, 10, 1)), is_ongoing: false,
    budget_end_date: new Date(D(2026, 12, 31)), coverage_start: null,
  };
  it("carries the fund flag, so the create job prices the share, not the total", () => {
    expect(build_self_provision_budget_created_payload({ ...args, is_fund: true } as never).is_fund).toBe(true);
    expect(build_self_provision_budget_created_payload(args as never).is_fund).toBeUndefined();
  });
});
