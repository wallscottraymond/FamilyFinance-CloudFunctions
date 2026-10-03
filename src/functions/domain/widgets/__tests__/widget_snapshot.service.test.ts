import {
  compute_left_to_spend,
  short_period_label,
  build_widget_snapshot,
  WidgetBudgetInput,
} from "../widget_snapshot.service";
import { hash_widget_token } from "../widget_token.service";

const b = (
  ee: boolean,
  periods: Array<[string, number, number | null, number]>
): WidgetBudgetInput => ({
  is_everything_else: ee,
  periods: periods.map(([period_id, allocated_amount, effective_amount, spent]) => ({
    period_id,
    allocated_amount,
    effective_amount,
    spent,
  })),
});

describe("compute_left_to_spend (mirrors mobile mapResult + computeBudgetSectionTotals)", () => {
  it("sums effective (incl. Everything-Else) and spent for the current period", () => {
    const r = compute_left_to_spend(
      [b(false, [["2026M10", 600, 650, 450]]), b(false, [["2026M10", 200, 200, 50]]), b(true, [["2026M10", 900, 900, 300]])],
      "2026M10"
    );
    expect(r).toEqual({ budgeted: 1750, spent: 800, available: 950, over: false, hasBudgets: true });
  });

  it("falls back to allocated when effective is missing, and to the first period when no match", () => {
    const r = compute_left_to_spend([b(false, [["2026M09", 400, null, 100]])], "2026M10");
    expect(r.budgeted).toBe(400);
    expect(r.spent).toBe(100);
  });

  it("over budget + Everything-Else-only", () => {
    expect(compute_left_to_spend([b(false, [["p", 100, 100, 180]])], "p").over).toBe(true);
    expect(compute_left_to_spend([b(true, [["p", 900, 900, 0]])], "p").hasBudgets).toBe(false);
    expect(compute_left_to_spend([], "p")).toEqual({ budgeted: 0, spent: 0, available: 0, over: false, hasBudgets: false });
  });
});

describe("short_period_label (mirrors mobile shortPeriodLabel)", () => {
  const start = Date.UTC(2026, 8, 28);
  it("monthly / weekly / bi_monthly", () => {
    expect(short_period_label("monthly", Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 31))).toBe("Oct");
    expect(short_period_label("weekly", start, start + 6 * 864e5)).toBe("Week of Sep 28");
    expect(short_period_label("bi_monthly", Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 15))).toBe("Oct 1–15");
  });
});

describe("build_widget_snapshot", () => {
  it("is schema v1 with one cadence", () => {
    const s = build_widget_snapshot({
      cadence: "monthly",
      period_id: "2026M10",
      start_ms: Date.UTC(2026, 9, 1),
      end_ms: Date.UTC(2026, 9, 31),
      budgets: [b(false, [["2026M10", 100, 100, 40]])],
      now_ms: 123,
    });
    expect(s).toEqual({
      v: 1,
      asOfMs: 123,
      defaultCadence: "monthly",
      cadences: {
        monthly: {
          periodLabel: "Oct",
          leftToSpend: { budgeted: 100, spent: 40, available: 60, over: false, hasBudgets: true },
        },
      },
    });
  });
});

describe("hash_widget_token", () => {
  it("is deterministic sha256 hex and never the raw token", () => {
    expect(hash_widget_token("abc")).toBe(hash_widget_token("abc"));
    expect(hash_widget_token("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hash_widget_token("abc")).not.toBe(hash_widget_token("abd"));
  });
});
