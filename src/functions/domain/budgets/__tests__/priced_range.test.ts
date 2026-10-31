/**
 * A partial first month is spread over its PRICED days only (Code-Health-Review batch 6 verify #2).
 * A $70/week budget starting Wed Jun 10 2026 is active from its first week (Sun Jun 7), so its June
 * monthly record holds 24 days × $10 = $240. The page used to spread that over all 30 days
 * ($8/day → $56 a week); each June week must show $70, the month $240.
 */
import { bucket_allocation } from "../period_allocation_view.service";
import { budget_priced_range, period_end_ms } from "../match_budgets.service";
import { synthesize_monthly_allocation } from "../period_generation.service";

const U = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const E = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 23, 59, 59, 999);
const JUNE = { allocated_amount: 240, effective_amount: 240, start_ms: U(2026, 6, 1), end_ms: E(2026, 6, 30) };
const priced = budget_priced_range(U(2026, 6, 10), "weekly", true, null);

describe("budget_priced_range", () => {
  it("starts at the budget's own period (the week holding its start)", () => {
    expect(priced).toEqual({ from_ms: U(2026, 6, 7), to_ms: null });
  });
  it("a limited budget is priced through the end of the period holding its end date", () => {
    expect(budget_priced_range(U(2026, 6, 10), "weekly", false, U(2026, 7, 1)).to_ms).toBe(E(2026, 7, 4));
    expect(period_end_ms(U(2026, 2, 20), "bi_monthly")).toBe(E(2026, 2, 28));
  });
});

describe("bucket_allocation with the priced range", () => {
  it("a full June week shows the weekly amount", () => {
    expect(bucket_allocation([JUNE], U(2026, 6, 14), E(2026, 6, 20), priced).allocated).toBe(70);
  });
  it("June as a whole shows the record; days before the start show nothing", () => {
    expect(bucket_allocation([JUNE], U(2026, 6, 1), E(2026, 6, 30), priced).allocated).toBe(240);
    expect(bucket_allocation([JUNE], U(2026, 6, 1), E(2026, 6, 6), priced).allocated).toBe(0);
  });
  it("without a range the whole month is used (EE / old callers)", () => {
    expect(bucket_allocation([JUNE], U(2026, 6, 14), E(2026, 6, 20)).allocated).toBe(56);
  });
});

describe("synthesize_monthly_allocation matches what generation stores", () => {
  it("weekly: priced days × amount / 7", () => {
    expect(synthesize_monthly_allocation(70, "weekly", U(2026, 6, 1), E(2026, 6, 30), priced)).toBe(240);
    expect(synthesize_monthly_allocation(70, "weekly", U(2026, 7, 1), E(2026, 7, 31), priced)).toBe(310);
  });
  it("monthly / yearly: the per-month amount", () => {
    const p = budget_priced_range(U(2026, 6, 10), "monthly", true, null);
    expect(synthesize_monthly_allocation(300, "monthly", U(2026, 6, 1), E(2026, 6, 30), p)).toBe(300);
    expect(synthesize_monthly_allocation(1200, "yearly", U(2026, 6, 1), E(2026, 6, 30), p)).toBe(100);
  });
});

import { stale_non_prime_refreshes } from "../period_generation.service";
import { BudgetPeriodEntity } from "../../../types/budgets/budget_entity.types";

describe("stale_non_prime_refreshes — the cron re-prices a short far-edge month", () => {
  const fresh = (id: string, allocated: number, is_prime = false) =>
    ({ id, allocated_amount: allocated, daily_rate: allocated / 31, is_prime, prime_period_ids: [], prime_period_breakdown: [] } as unknown as BudgetPeriodEntity);
  const stored = (id: string, allocated: number, o: Partial<{ end_ms: number; is_user_edited: boolean; spent: number }> = {}) => ({
    id, allocated_amount: allocated, spent: o.spent ?? 0, rolled_over_amount: 0,
    end_ms: o.end_ms ?? E(2027, 7, 31), is_user_edited: o.is_user_edited ?? false,
  });
  const cutoff = U(2026, 10, 30);
  it("a future month that is short gets the full price; remaining keeps its spend", () => {
    const out = stale_non_prime_refreshes([fresh("m", 310)], [stored("m", 110, { spent: 20 })], cutoff);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "m", allocated_amount: 310, remaining: 290, is_prime: false });
  });
  it("leaves: unchanged, past, user-edited, and prime periods", () => {
    expect(stale_non_prime_refreshes([fresh("m", 310)], [stored("m", 310)], cutoff)).toEqual([]);
    expect(stale_non_prime_refreshes([fresh("m", 310)], [stored("m", 110, { end_ms: E(2026, 9, 30) })], cutoff)).toEqual([]);
    expect(stale_non_prime_refreshes([fresh("m", 310)], [stored("m", 110, { is_user_edited: true })], cutoff)).toEqual([]);
    expect(stale_non_prime_refreshes([fresh("w", 70, true)], [stored("w", 10)], cutoff)).toEqual([]);
  });
});
