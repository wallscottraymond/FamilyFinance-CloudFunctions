/**
 * Manual Inflow — the first date is a calendar day (Code-Health-Review M2-M3).
 *
 * The builder computed the UTC day of the first date but stored the raw instant, so an income
 * added in the evening kept its time of day and could land a day off once snapped elsewhere.
 */
import { build_manual_inflow } from "../manual_inflow.service";

const base = {
  id: "manual_inflow_test", user_id: "user_1", name: "Paycheck", amount: 2000,
  frequency: "biweekly" as const, description: null, income_type: "salary",
  is_regular_salary: true, income_variability: "fixed", hourly_config: null,
  commission_config: null, bonus_config: null, variable_config: null,
  account_id: "acct_1", vendor_key: null, now_ms: Date.UTC(2026, 9, 30, 12),
};

describe("build_manual_inflow", () => {
  it("stores the first / next dates at UTC midnight of the given day", () => {
    const { inflow, errors } = build_manual_inflow({ ...base, first_expected_ms: Date.UTC(2026, 9, 30, 21, 37, 5) });
    expect(errors).toBeUndefined();
    const midnight = Date.UTC(2026, 9, 30);
    const i = inflow as unknown as Record<string, Date | { toMillis(): number }>;
    const at = (v: Date | { toMillis(): number }) => (v instanceof Date ? v.getTime() : v.toMillis());
    expect(at(i.first_date)).toBe(midnight);
    expect(at(i.predicted_next_date)).toBe(midnight);
    expect(at(i.last_date)).toBe(midnight);
  });
});
