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
    spend_status: "counted",
    outflow_id: null,
    inflow_id: null,
    ...over,
  };
}

describe("is_countable", () => {
  it("excludes transfer / ignored / recurring; refund STAYS countable", () => {
    expect(is_countable(s())).toBe(true);
    expect(is_countable(s({ is_transfer: true }))).toBe(false);
    expect(is_countable(s({ spend_status: "ignored" }))).toBe(false);
    expect(is_countable(s({ spend_status: "refund" }))).toBe(true); // still in spent
    expect(is_countable(s({ outflow_id: "o1" }))).toBe(false);
    expect(is_countable(s({ inflow_id: "i1" }))).toBe(false);
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
