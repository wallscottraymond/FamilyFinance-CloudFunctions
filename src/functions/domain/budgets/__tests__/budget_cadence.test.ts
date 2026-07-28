/**
 * budget_cadence_to_instance — unit tests
 *
 * Guards the Per-Period-Everything-Else Phase 0 change: bi_monthly is a
 * first-class PRIME cadence and must NOT be clamped to monthly. weekly/monthly
 * pass through 1:1; quarterly/yearly/custom have no matching source-period type
 * so they allocate on the monthly grid.
 */

import { budget_cadence_to_instance } from "../period_generation.service";

describe("budget_cadence_to_instance", () => {
  it("maps the three real prime cadences 1:1", () => {
    expect(budget_cadence_to_instance("weekly")).toBe("weekly");
    expect(budget_cadence_to_instance("monthly")).toBe("monthly");
    expect(budget_cadence_to_instance("bi_monthly")).toBe("bi_monthly");
  });

  it("does NOT clamp bi_monthly to monthly (the Phase 0 bug fix)", () => {
    expect(budget_cadence_to_instance("bi_monthly")).not.toBe("monthly");
  });

  it("falls quarterly/yearly/custom back to the monthly grid", () => {
    expect(budget_cadence_to_instance("quarterly")).toBe("monthly");
    expect(budget_cadence_to_instance("yearly")).toBe("monthly");
    expect(budget_cadence_to_instance("custom")).toBe("monthly");
  });
});
