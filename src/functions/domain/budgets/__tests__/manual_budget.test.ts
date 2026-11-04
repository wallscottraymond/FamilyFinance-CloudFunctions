/** A manual budget has no categories: it receives only what the user puts in it (AF-02). */
import { owned_splits_for_budget, SplitForOnReadMatch } from "../budget_spend_match.service";
import { compute_budget_spent } from "../budget_spend.service";

const manual = { id: "xmas", category_ids: [], start_ms: 0, end_ms: null, is_ongoing: true, cadence: "monthly" } as never;
const split = (extra: Partial<SplitForOnReadMatch>): SplitForOnReadMatch => ({
  amount: 100, txn_date_ms: 1000, is_pending: false, is_transfer: false, is_income: false,
  spend_status: "counted", outflow_id: null, inflow_id: null, first_category_id: "shopping",
  semantic_code: "GENERAL_MERCHANDISE", manual_pin_budget_id: null, ...extra,
});

const owned = (id: string, s: SplitForOnReadMatch[]) => owned_splits_for_budget(id, [manual], "ee", s);

describe("manual budgets", () => {
  it("a category never pulls a transaction in; it stays in Everything Else", () => {
    expect(owned("xmas", [split({})])).toHaveLength(0);
    expect(owned("ee", [split({})])).toHaveLength(1);
  });
  it("a split with no category stays out too", () => {
    expect(owned("xmas", [split({ first_category_id: null })])).toHaveLength(0);
  });
  it("a split pinned to it counts there, once", () => {
    const pinned = split({ manual_pin_budget_id: "xmas" });
    expect(compute_budget_spent("xmas", 0, 2000, owned("xmas", [pinned])).spent).toBe(100);
    expect(owned("ee", [pinned])).toHaveLength(0);
  });
});
