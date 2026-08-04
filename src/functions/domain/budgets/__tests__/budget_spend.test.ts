/**
 * budget_spend Domain Service — Unit Tests
 *
 * Verifies the countable predicate (transfer/ignored/recurring excluded), the
 * amount-sign behavior (a negative amount nets spend down), the `refund` status
 * (stays in spent + accrues `return_amount`), pending tracking, period-range
 * filtering, and per-budget scoping. Invalidation-based: recompute from current
 * splits, no drift.
 */

import {
  compute_budget_spent,
  is_countable,
  is_transfer_category,
  SplitForSpend,
} from "../budget_spend.service";

const JUN_01 = Date.UTC(2026, 5, 1);
const JUN_30 = Date.UTC(2026, 5, 30, 23, 59, 59);
const JUN_15 = Date.UTC(2026, 5, 15);
const JUL_15 = Date.UTC(2026, 6, 15);

function s(over: Partial<SplitForSpend> = {}): SplitForSpend {
  return {
    budget_id: "b1",
    amount: 100,
    txn_date_ms: JUN_15,
    is_pending: false,
    is_transfer: false,
    is_income: false,
    is_income_category: false,
    spend_status: "counted",
    outflow_id: null,
    inflow_id: null,
    ...over,
  };
}

describe("is_transfer_category", () => {
  it("flags Plaid TRANSFER_IN/OUT detailed categories", () => {
    expect(is_transfer_category("TRANSFER_OUT_ACCOUNT_TRANSFER")).toBe(true);
    expect(is_transfer_category("TRANSFER_IN_ACCOUNT_TRANSFER")).toBe(true);
    expect(is_transfer_category("TRANSFER_OUT_WITHDRAWAL")).toBe(true);
    expect(is_transfer_category("TRANSFER_IN_DEPOSIT")).toBe(true);
  });
  it("does NOT flag spending categories or empty values", () => {
    expect(is_transfer_category("FOOD_AND_DRINK_GROCERIES")).toBe(false);
    expect(is_transfer_category("LOAN_PAYMENTS_MORTGAGE_PAYMENT")).toBe(false);
    expect(is_transfer_category(null)).toBe(false);
    expect(is_transfer_category(undefined)).toBe(false);
    expect(is_transfer_category("")).toBe(false);
  });
});

describe("is_countable", () => {
  it("excludes transfer / income-category / ignored / recurring; refund STAYS countable", () => {
    expect(is_countable(s())).toBe(true);
    expect(is_countable(s({ is_transfer: true }))).toBe(false);
    expect(is_countable(s({ is_income_category: true }))).toBe(false); // real income excluded
    expect(is_countable(s({ spend_status: "ignored" }))).toBe(false);
    expect(is_countable(s({ spend_status: "refund" }))).toBe(true); // still in spent
    expect(is_countable(s({ outflow_id: "o1" }))).toBe(false);
    expect(is_countable(s({ inflow_id: "i1" }))).toBe(false);
  });
});

describe("income treatment in compute_budget_spent", () => {
  const B = "b1";
  it("a one-off income return (expense category) reverses spent", () => {
    // $100 expense + $30 income return (e.g. an item refund) → net $70 spent.
    const r = compute_budget_spent(B, JUN_01, JUN_30, [
      s({ amount: 100 }),
      s({ amount: 30, is_income: true }),
    ]);
    expect(r.spent).toBe(70);
    expect(r.return_amount).toBe(30);
  });
  it("real income (INCOME_* category) is excluded entirely — neither adds nor reverses", () => {
    const r = compute_budget_spent(B, JUN_01, JUN_30, [
      s({ amount: 100 }),
      s({ amount: 36725, is_income: true, is_income_category: true }),
    ]);
    expect(r.spent).toBe(100);
    expect(r.return_amount).toBe(0);
  });
});

describe("compute_budget_spent", () => {
  it("sums countable splits assigned to the budget in the period", () => {
    const r = compute_budget_spent("b1", JUN_01, JUN_30, [s({ amount: 60 }), s({ amount: 40 })]);
    expect(r.spent).toBe(100);
    expect(r.pending_spent).toBe(0);
    expect(r.return_amount).toBe(0);
  });

  it("ignores splits assigned to other budgets", () => {
    const r = compute_budget_spent("b1", JUN_01, JUN_30, [s({ amount: 60 }), s({ budget_id: "b2", amount: 999 })]);
    expect(r.spent).toBe(60);
  });

  it("ignores splits outside the period range", () => {
    const r = compute_budget_spent("b1", JUN_01, JUN_30, [s({ amount: 60 }), s({ amount: 999, txn_date_ms: JUL_15 })]);
    expect(r.spent).toBe(60);
  });

  it("a NEGATIVE amount (real credit) nets the spend down", () => {
    const r = compute_budget_spent("b1", JUN_01, JUN_30, [s({ amount: 100 }), s({ amount: -30 })]);
    expect(r.spent).toBe(70);
    expect(r.return_amount).toBe(0); // status 'counted' — not an expected return
  });

  it("a 'refund' split STAYS in spent AND accrues return_amount (|amount|)", () => {
    const r = compute_budget_spent("b1", JUN_01, JUN_30, [
      s({ amount: 100 }),
      s({ amount: 80, spend_status: "refund" }),
    ]);
    expect(r.spent).toBe(180); // you paid — still counted
    expect(r.return_amount).toBe(80); // expected back
  });

  it("'ignored' is excluded from spent and does not affect return_amount", () => {
    const r = compute_budget_spent("b1", JUN_01, JUN_30, [
      s({ amount: 100 }),
      s({ amount: 500, spend_status: "ignored" }),
    ]);
    expect(r.spent).toBe(100);
    expect(r.return_amount).toBe(0);
  });

  it("excludes transfers and recurring-linked splits from the sum", () => {
    const r = compute_budget_spent("b1", JUN_01, JUN_30, [
      s({ amount: 100 }),
      s({ amount: 200, is_transfer: true }),
      s({ amount: 300, outflow_id: "o1" }),
      s({ amount: 400, inflow_id: "i1" }),
      s({ amount: 500, spend_status: "ignored" }),
    ]);
    expect(r.spent).toBe(100);
  });

  it("tracks the pending portion separately (counted in both)", () => {
    const r = compute_budget_spent("b1", JUN_01, JUN_30, [
      s({ amount: 60, is_pending: false }),
      s({ amount: 40, is_pending: true }),
    ]);
    expect(r.spent).toBe(100);
    expect(r.pending_spent).toBe(40);
  });

  it("empty / no-match → zero", () => {
    expect(compute_budget_spent("b1", JUN_01, JUN_30, [])).toEqual({
      spent: 0,
      pending_spent: 0,
      return_amount: 0,
    });
  });

  it("is deterministic", () => {
    const splits = [s({ amount: 60 }), s({ amount: 40, spend_status: "refund" })];
    expect(compute_budget_spent("b1", JUN_01, JUN_30, splits)).toEqual(
      compute_budget_spent("b1", JUN_01, JUN_30, splits)
    );
  });
});
