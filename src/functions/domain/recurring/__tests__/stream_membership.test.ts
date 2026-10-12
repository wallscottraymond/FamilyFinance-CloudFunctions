/**
 * build_stream_membership_map — Unit Tests
 *
 * The `txn id → recurring id` map with the CONFLICT rule: an id claimed by two streams
 * is excluded (no arbitrary last-writer-wins guess).
 */

import {
  build_stream_membership_map,
  is_split_detached_from_outflow,
  is_txn_detached_from_outflow,
  is_split_detached_from_inflow,
  is_txn_detached_from_inflow,
  splits_paying_recurring,
  is_other_income_split,
} from "../stream_membership";

describe("build_stream_membership_map", () => {
  it("maps each transaction id to its single owning stream", () => {
    const map = build_stream_membership_map([
      { id: "billA", transaction_ids: ["t1", "t2"] },
      { id: "billB", transaction_ids: ["t3"] },
    ]);
    expect(map.get("t1")).toBe("billA");
    expect(map.get("t2")).toBe("billA");
    expect(map.get("t3")).toBe("billB");
    expect(map.size).toBe(3);
  });

  it("EXCLUDES an id claimed by two different streams (no guess), regardless of order", () => {
    const forward = build_stream_membership_map([
      { id: "capOne", transaction_ids: ["shared", "c1"] },
      { id: "sofi", transaction_ids: ["shared", "s1"] },
    ]);
    const reversed = build_stream_membership_map([
      { id: "sofi", transaction_ids: ["shared", "s1"] },
      { id: "capOne", transaction_ids: ["shared", "c1"] },
    ]);
    expect(forward.has("shared")).toBe(false); // ambiguous → dropped
    expect(reversed.has("shared")).toBe(false); // same result either order (deterministic)
    // Non-conflicting ids still map.
    expect(forward.get("c1")).toBe("capOne");
    expect(forward.get("s1")).toBe("sofi");
  });

  it("tolerates missing/empty transaction_ids", () => {
    const map = build_stream_membership_map([
      { id: "a", transaction_ids: null },
      { id: "b" },
      { id: "c", transaction_ids: [] },
    ]);
    expect(map.size).toBe(0);
  });

  it("a duplicate id within the SAME stream is not a conflict", () => {
    const map = build_stream_membership_map([{ id: "a", transaction_ids: ["t1", "t1"] }]);
    expect(map.get("t1")).toBe("a");
  });
});

describe("manual bill detach", () => {
  it("a manual source with no outflow is a detach", () => {
    expect(is_split_detached_from_outflow({ outflowAssignmentSource: "manual", outflowId: null })).toBe(true);
    expect(is_split_detached_from_outflow({ outflowAssignmentSource: "manual" })).toBe(true);
  });

  it("a manual PIN to a bill, or an auto split, is not a detach", () => {
    expect(is_split_detached_from_outflow({ outflowAssignmentSource: "manual", outflowId: "b" })).toBe(false);
    expect(is_split_detached_from_outflow({ outflowAssignmentSource: "auto", outflowId: null })).toBe(false);
    expect(is_split_detached_from_outflow({})).toBe(false);
  });

  it("a transaction is detached when any split is", () => {
    expect(
      is_txn_detached_from_outflow([
        { outflowAssignmentSource: "auto" },
        { outflowAssignmentSource: "manual", outflowId: null },
      ])
    ).toBe(true);
    expect(is_txn_detached_from_outflow([{ outflowAssignmentSource: "auto" }])).toBe(false);
    expect(is_txn_detached_from_outflow(undefined)).toBe(false);
  });

  it("a manual BUDGET pin takes a split off its bills and income (canon A4)", () => {
    expect(is_split_detached_from_outflow({ budgetAssignmentSource: "manual" })).toBe(true);
    expect(is_split_detached_from_inflow({ budgetAssignmentSource: "manual" })).toBe(true);
    // ...unless the user ALSO pinned it to a bill
    expect(is_split_detached_from_outflow({
      budgetAssignmentSource: "manual", outflowAssignmentSource: "manual", outflowId: "b",
    })).toBe(false);
    expect(is_txn_detached_from_inflow([{ budgetAssignmentSource: "category" }])).toBe(false);
  });

  it("splits_paying_recurring: per split — taking one split off never unlinks the others", () => {
    const pinned = { splitId: "a", amount: 50, budgetAssignmentSource: "manual" };
    const plain = { splitId: "b", amount: 100 };
    expect(splits_paying_recurring([pinned, plain], "outflow", "bill", true)).toEqual([plain]);
    // Explicit links win; not a stream member → only explicit links.
    const linked = { splitId: "c", outflowId: "bill" };
    expect(splits_paying_recurring([linked, plain], "outflow", "bill", true)).toEqual([linked]);
    expect(splits_paying_recurring([plain], "outflow", "bill", false)).toEqual([]);
    // A split pinned to ANOTHER bill isn't this bill's.
    expect(splits_paying_recurring([{ outflowId: "x", outflowAssignmentSource: "manual" }], "outflow", "bill", true)).toEqual([]);
  });

  it("is_other_income_split: by the split's EFFECTIVE category, never also paying / pinned", () => {
    expect(is_other_income_split({}, "INCOME_WAGES", false)).toBe(true);
    // a deposit the user re-categorized to Groceries nets Groceries — not ALSO income
    expect(is_other_income_split({}, "FOOD_AND_DRINK_GROCERIES", false)).toBe(false);
    // a transfer the user re-categorized to income IS income (was counted nowhere)
    expect(is_other_income_split({ plaidDetailedCategory: "TRANSFER_IN_DEPOSIT" }, "INCOME_OTHER_INCOME", false)).toBe(true);
    expect(is_other_income_split({}, "INCOME_WAGES", true)).toBe(false); // on its income stream
    expect(is_other_income_split({ inflowId: "inc" }, "INCOME_WAGES", false)).toBe(false);
    expect(is_other_income_split({ budgetAssignmentSource: "manual" }, "INCOME_WAGES", false)).toBe(false);
  });
});

