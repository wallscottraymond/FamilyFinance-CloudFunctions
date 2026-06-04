/**
 * assignment_field_guard Domain Service — Unit Tests
 */

import { is_assignment_relevant_change } from "../assignment_field_guard.service";

const ts = (ms: number) => ({ toMillis: () => ms });

function txn(over: Record<string, unknown> = {}) {
  return {
    transactionDate: ts(1000),
    amount: 100,
    isActive: true,
    merchantName: "Store",
    name: "purchase",
    splits: [
      {
        splitId: "s1",
        amount: 100,
        budgetId: "b1",
        budgetAssignmentSource: "category",
        internalPrimaryCategory: null,
        plaidPrimaryCategory: "FOOD_AND_DRINK",
        outflowId: null,
        inflowId: null,
        isIgnored: false,
        description: "note", // cosmetic
        tags: [], // cosmetic
      },
    ],
    description: "cosmetic",
    ...over,
  };
}

describe("is_assignment_relevant_change", () => {
  it("create (no before) is relevant", () => {
    expect(is_assignment_relevant_change(null, txn())).toBe(true);
  });

  it("hard delete (no after) is relevant", () => {
    expect(is_assignment_relevant_change(txn(), null)).toBe(true);
  });

  it("identical state is NOT relevant", () => {
    expect(is_assignment_relevant_change(txn(), txn())).toBe(false);
  });

  it("amount change is relevant", () => {
    expect(is_assignment_relevant_change(txn(), txn({ amount: 120 }))).toBe(true);
  });

  it("date change is relevant", () => {
    expect(is_assignment_relevant_change(txn(), txn({ transactionDate: ts(2000) }))).toBe(true);
  });

  it("isActive flip (delete/restore) is relevant", () => {
    expect(is_assignment_relevant_change(txn(), txn({ isActive: false }))).toBe(true);
  });

  it("merchant change is relevant (feeds category)", () => {
    expect(is_assignment_relevant_change(txn(), txn({ merchantName: "Other" }))).toBe(true);
  });

  it("split category change is relevant", () => {
    const after = txn({ splits: [{ ...txn().splits[0], plaidPrimaryCategory: "TRAVEL" }] });
    expect(is_assignment_relevant_change(txn(), after)).toBe(true);
  });

  it("split amount / manual pin / ignored changes are relevant", () => {
    expect(is_assignment_relevant_change(txn(), txn({ splits: [{ ...txn().splits[0], amount: 50 }] }))).toBe(true);
    expect(is_assignment_relevant_change(txn(), txn({ splits: [{ ...txn().splits[0], budgetAssignmentSource: "manual" }] }))).toBe(true);
    expect(is_assignment_relevant_change(txn(), txn({ splits: [{ ...txn().splits[0], isIgnored: true }] }))).toBe(true);
  });

  it("split add/remove is relevant", () => {
    const after = txn({ splits: [txn().splits[0], { ...txn().splits[0], splitId: "s2" }] });
    expect(is_assignment_relevant_change(txn(), after)).toBe(true);
  });

  it("cosmetic-only edits (description, tags) are NOT relevant", () => {
    const after = txn({
      description: "different note",
      splits: [{ ...txn().splits[0], description: "new", tags: ["x"] }],
    });
    expect(is_assignment_relevant_change(txn(), after)).toBe(false);
  });

  it("split order doesn't matter (sorted by splitId)", () => {
    const a = txn({ splits: [{ ...txn().splits[0], splitId: "s1" }, { ...txn().splits[0], splitId: "s2" }] });
    const b = txn({ splits: [{ ...txn().splits[0], splitId: "s2" }, { ...txn().splits[0], splitId: "s1" }] });
    expect(is_assignment_relevant_change(a, b)).toBe(false);
  });
});
