/** AF-08: the Summary widget plans income at what was expected, as the app does. */
import { compute_period_summary } from "../widget_snapshot.service";

it("a deposit above expected raises received, not planned", () => {
  const income = [{
    recurring_id: "line", name: "Paycheck",
    groups: [{ period_id: "P", is_due_period: true, occurrences: [
      { due_ms: 1, paid: true, amount: 100236.72, expected_amount: 9355 },
      { due_ms: 2, paid: true, amount: 3358.43, expected_amount: 3455 },
    ] }],
  }];
  const r = compute_period_summary({ income, bills: [], budgets: [] } as never, "P", []);
  expect(r.income.planned).toBe(12810);
  expect(r.income.actual).toBeCloseTo(103595.15, 2);
});

it("a paid bill is planned at what was expected, as the app", () => {
  const bills = [{
    recurring_id: "bill", name: "Power",
    groups: [{ period_id: "P", is_due_period: true, occurrences: [{ due_ms: 1, paid: true, amount: 109.5, expected_amount: 100 }] }],
  }];
  const r = compute_period_summary({ income: [], bills, budgets: [] } as never, "P", []);
  expect(r.bills.planned).toBe(100);
  expect(r.bills.actual).toBe(109.5);
});
