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

  it("a status / amount edit is NOT assignment-relevant (no engine run)", () => {
    expect(run([{ ...stored, spendStatus: "refund", amount: 30 }]).assignment_relevant).toBe(false);
  });

  it("a category pick, a budget pin, a bill pin or a split add IS", () => {
    expect(run([{ ...stored, categorySource: "user", firstCategoryId: "shopping" }]).assignment_relevant).toBe(true);
    expect(run([{ ...stored, budgetAssignmentSource: "manual", budgetId: "b_x" }]).assignment_relevant).toBe(true);
    expect(run([{ ...stored, outflowId: "other_bill" }]).assignment_relevant).toBe(true);
    expect(run([stored, { amount: 5 }]).assignment_relevant).toBe(true);
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
