import {
  compute_left_to_spend,
  compute_period_summary,
  compute_bills_due_soon,
  occurrences_of,
  short_period_label,
  WidgetBudgetInput,
  WidgetRecurringInput,
  WidgetOccurrenceGroupInput,
} from "../widget_snapshot.service";
import { hash_widget_token } from "../widget_token.service";

const P = "2026M10";

const budget = (ee: boolean, allocated: number, effective: number | null, spent: number, pid = P): WidgetBudgetInput => ({
  is_everything_else: ee,
  periods: [{ period_id: pid, allocated_amount: allocated, effective_amount: effective, spent }],
});

const group = (over: Partial<WidgetOccurrenceGroupInput>): WidgetOccurrenceGroupInput => ({
  period_id: P,
  is_due_period: true,
  count_in_period: 1,
  count_paid: 0,
  total_due: 0,
  first_due_ms: null,
  next_unpaid_due_ms: null,
  occurrences: [],
  ...over,
});

const rec = (id: string, groups: WidgetOccurrenceGroupInput[]): WidgetRecurringInput => ({
  recurring_id: id,
  name: id,
  groups,
});

describe("compute_left_to_spend (mobile mapResult + computeBudgetSectionTotals)", () => {
  const budgets = [budget(false, 600, 650, 450), budget(false, 200, 200, 50), budget(true, 900, 900, 300)];
  it("includes Everything-Else + rollover (Home Budgets card)", () => {
    expect(compute_left_to_spend(budgets, P)).toEqual({
      budgeted: 1750, spent: 800, available: 950, over: false, hasBudgets: true,
    });
  });
  it("real budgets only variant", () => {
    expect(compute_left_to_spend(budgets, P, false)).toMatchObject({ budgeted: 850, spent: 500, available: 350 });
  });
  it("effective falls back to allocated; unmatched period falls back to the first", () => {
    expect(compute_left_to_spend([budget(false, 400, null, 100, "2026M09")], P).budgeted).toBe(400);
  });
  it("over / Everything-Else only / empty", () => {
    expect(compute_left_to_spend([budget(false, 100, 100, 180)], P).over).toBe(true);
    expect(compute_left_to_spend([budget(true, 900, 900, 0)], P).hasBudgets).toBe(false);
    expect(compute_left_to_spend([], P)).toEqual({ budgeted: 0, spent: 0, available: 0, over: false, hasBudgets: false });
  });
});

describe("occurrences_of (mobile occurrencesOf)", () => {
  it("uses placed occurrences when present", () => {
    const occ = [{ due_ms: 1, paid: true, amount: 5 }];
    expect(occurrences_of(group({ occurrences: occ }))).toBe(occ);
  });
  it("falls back to one aggregate row; none when count is 0", () => {
    expect(occurrences_of(group({ count_in_period: 2, count_paid: 2, total_due: 80, first_due_ms: 9 }))).toEqual([
      { due_ms: 9, paid: true, amount: 80 },
    ]);
    expect(occurrences_of(group({ count_in_period: 0 }))).toEqual([]);
  });
});

describe("compute_period_summary (mobile mapResult + computePeriodSummary)", () => {
  const derived = {
    budgets: [budget(false, 600, 650, 450), budget(true, 900, 900, 300)],
    bills: [
      rec("rent", [group({ occurrences: [{ due_ms: 1, paid: true, amount: 1800 }] })]),
      rec("phone", [group({ occurrences: [{ due_ms: 2, paid: false, amount: 60 }] })]),
      rec("notdue", [group({ is_due_period: false, occurrences: [{ due_ms: 3, paid: false, amount: 99 }] })]),
    ],
    income: [
      rec("pay", [group({ occurrences: [{ due_ms: 1, paid: true, amount: 2000 }, { due_ms: 15, paid: false, amount: 2100 }] })]),
    ],
  };
  const goals = [
    { status: "active", targetForPeriod: 300, progressForPeriod: 120 },
    { status: "paused", targetForPeriod: 999, progressForPeriod: 999 },
  ];
  it("four planned/actual pairs; budgets = real only by ALLOCATED; active goals only", () => {
    expect(compute_period_summary(derived, P, goals)).toEqual({
      income: { planned: 4100, actual: 2000 },
      bills: { planned: 1860, actual: 1800 },
      budgets: { planned: 600, actual: 450 },
      goals: { planned: 300, actual: 120 },
      isEmpty: false,
    });
  });
  it("isEmpty when nothing to summarize (Everything-Else alone doesn't count)", () => {
    expect(compute_period_summary({ budgets: [budget(true, 1, 1, 0)], bills: [], income: [] }, P, []).isEmpty).toBe(true);
  });
});

describe("compute_bills_due_soon", () => {
  const now = Date.UTC(2026, 9, 10, 15); // Oct 10, 3pm UTC
  const day = (d: number) => Date.UTC(2026, 9, d);
  const oct = [
    rec("late", [group({ occurrences: [{ due_ms: day(5), paid: false, amount: 40 }] })]),
    rec("paid", [group({ occurrences: [{ due_ms: day(11), paid: true, amount: 10 }] })]),
    rec("soon", [group({ occurrences: [{ due_ms: day(12), paid: false, amount: 60 }] })]),
    rec("today", [group({ occurrences: [{ due_ms: day(10), paid: false, amount: 25 }] })]),
    rec("far", [group({ occurrences: [{ due_ms: day(30), paid: false, amount: 99 }] })]),
  ];
  const nov = [rec("nov", [group({ period_id: "2026M11", occurrences: [{ due_ms: Date.UTC(2026, 10, 2), paid: false, amount: 15 }] })])];

  it("unpaid within the look-ahead, overdue flagged, soonest first", () => {
    const r = compute_bills_due_soon([{ period_id: P, bills: oct }], now, 7);
    expect(r.items.map((i) => [i.id, i.overdue])).toEqual([["late", true], ["today", false], ["soon", false]]);
    expect(r.moreCount).toBe(0);
  });
  it("30-day look-ahead reaches into next month's derive", () => {
    const r = compute_bills_due_soon([{ period_id: P, bills: oct }, { period_id: "2026M11", bills: nov }], now, 30);
    expect(r.items.map((i) => i.id)).toEqual(["late", "today", "soon", "far", "nov"]);
    expect(r.items.map((i) => i.periodId)).toEqual([P, P, P, P, "2026M11"]);
  });
  it("caps at 6 and reports the rest", () => {
    const many = Array.from({ length: 9 }, (_, i) => rec(`b${i}`, [group({ occurrences: [{ due_ms: day(11), paid: false, amount: i }] })]));
    const r = compute_bills_due_soon([{ period_id: P, bills: many }], now, 7);
    expect(r.items).toHaveLength(6);
    expect(r.moreCount).toBe(3);
  });
});

describe("short_period_label (mobile shortPeriodLabel)", () => {
  it("monthly / weekly / bi_monthly", () => {
    expect(short_period_label("monthly", Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 31))).toBe("Oct");
    expect(short_period_label("weekly", Date.UTC(2026, 8, 28), Date.UTC(2026, 9, 4))).toBe("Week of Sep 28");
    expect(short_period_label("bi_monthly", Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 15))).toBe("Oct 1–15");
  });
});

describe("hash_widget_token", () => {
  it("deterministic sha256 hex", () => {
    expect(hash_widget_token("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hash_widget_token("abc")).toBe(hash_widget_token("abc"));
    expect(hash_widget_token("abc")).not.toBe(hash_widget_token("abd"));
  });
});
