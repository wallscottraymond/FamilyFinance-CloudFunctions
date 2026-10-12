/**
 * build_split_edit — merge onto stored splits; what an edit means for assignment. Pure.
 */
import { build_category_catalog } from "../split_category.service";
import { build_split_edit } from "../split_edit.service";

const catalog = build_category_catalog([
  { id: "FOOD_AND_DRINK_GROCERIES", data: { firstCategoryId: "groceries", overallCategoryId: "food" } },
  { id: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE", data: { firstCategoryId: "shopping", overallCategoryId: "shop" } },
]);
const stored = {
  splitId: "s1", id: "s1", amount: 40, plaidDetailedCategory: "FOOD_AND_DRINK_GROCERIES",
  categorySource: "plaid", firstCategoryId: "groceries", spendStatus: "counted",
  tags: ["t1"], isTaxDeductible: true, outflowId: "bill", outflowAssignmentSource: "manual",
  monthlyBudgetId: "b_g", budgetId: "b_g", budgetAssignmentSource: "category",
};
const txn = { splits: [stored] };
const run = (incoming: Record<string, unknown>[]) =>
  build_split_edit(incoming, txn, catalog, "u", "NOW", (i) => `new_${i}`);

describe("build_split_edit", () => {
  it("an older app omitting fields can't erase them (merged onto the stored split)", () => {
    const r = run([{ splitId: "s1", amount: 40, spendStatus: "ignored" }]);
    expect(r.splits[0]).toMatchObject({
      tags: ["t1"], isTaxDeductible: true, outflowId: "bill", outflowAssignmentSource: "manual",
      monthlyBudgetId: "b_g", spendStatus: "ignored", firstCategoryId: "groceries",
    });
  });

  it("a status / note edit is NOT assignment-relevant (no engine run)", () => {
    expect(run([{ ...stored, spendStatus: "refund" }]).assignment_relevant).toBe(false);
    expect(run([{ ...stored, amount: "40.00" }]).assignment_relevant).toBe(false); // same amount
  });

  it("an amount edit IS (the bill / income matcher scores on the split amount)", () => {
    expect(run([{ ...stored, amount: 30 }]).assignment_relevant).toBe(true);
  });

  it("a category pick, a budget pin or a split add IS", () => {
    expect(run([{ ...stored, categorySource: "user", firstCategoryId: "shopping" }]).assignment_relevant).toBe(true);
    expect(run([{ ...stored, budgetAssignmentSource: "manual", budgetId: "b_x" }]).assignment_relevant).toBe(true);
    expect(run([stored, { amount: 5 }]).assignment_relevant).toBe(true);
  });

  it("engine-owned fields the app echoes back stale are ignored (the stored split wins)", () => {
    // The app read the split while it was in Everything Else; a re-assign moved it since.
    const stale_echo = {
      ...stored, spendStatus: "ignored", budgetId: "ee", monthlyBudgetId: "ee",
      weeklyBudgetId: "ee_w", outflowId: null, monthlyPeriodId: "old", inflowId: "inc",
    };
    const r = run([stale_echo]);
    expect(r.splits[0]).toMatchObject({
      spendStatus: "ignored", budgetId: "b_g", monthlyBudgetId: "b_g", outflowId: "bill",
      outflowAssignmentSource: "manual", inflowId: null,
    });
    expect(r.assignment_relevant).toBe(false); // spend-only: nothing the engine decides moved
  });

  it("the user's new budget pin IS taken from the app; bill links never are", () => {
    const pinned = run([{ ...stored, budgetAssignmentSource: "manual", budgetId: "b_x" }]);
    expect(pinned.splits[0]).toMatchObject({ budgetAssignmentSource: "manual", budgetId: "b_x" });
    expect(pinned.assignment_relevant).toBe(true);
    // A stale echo of "category" over a stored pin is NOT an unpin (the app never sends one).
    const was_pinned = { splits: [{ ...stored, budgetAssignmentSource: "manual", budgetId: "b_x" }] };
    const echoed = build_split_edit(
      [{ ...stored, budgetAssignmentSource: "category", budgetId: "b_g" }],
      was_pinned, catalog, "u", "NOW", (i) => `n_${i}`
    );
    expect(echoed.splits[0]).toMatchObject({ budgetAssignmentSource: "manual", budgetId: "b_x" });
    const bill = run([{ ...stored, outflowId: "other_bill", outflowAssignmentSource: "manual" }]);
    expect(bill.splits[0]).toMatchObject({ outflowId: "bill", outflowAssignmentSource: "manual" });
  });

  it("category_changed only when a category moved", () => {
    expect(run([{ ...stored, spendStatus: "ignored" }]).category_changed).toBe(false);
    expect(run([{ ...stored, categorySource: "user", firstCategoryId: "shopping" }]).category_changed).toBe(true);
  });

  it("totals + refund / ignored summaries come from the final splits", () => {
    const r = run([{ ...stored, spendStatus: "refund" }, { amount: 10, spendStatus: "ignored" }]);
    expect(r.totals).toEqual({
      isSplit: true, totalAllocated: 50, returnAmount: 40, hasRefundSplits: true, hasIgnoredSplits: true,
    });
  });
});
