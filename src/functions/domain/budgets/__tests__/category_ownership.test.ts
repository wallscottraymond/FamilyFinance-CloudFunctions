
import { plan_view_claims } from "../category_ownership.service";

describe("plan_view_claims (canon A3 per view, A3b ≥ 1)", () => {
  const FIRST: Record<string, string> = {
    FOOD_AND_DRINK_GROCERIES: "groceries",
    GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE: "shopping",
  };
  const first_of = (id: string) => FIRST[id] ?? null;
  const view = [
    { id: "b_food", name: "Food", category_ids: ["groceries", "eating_out"], is_everything_else: false },
    { id: "b_shop", name: "Shopping", category_ids: ["shopping"], is_everything_else: false },
    { id: "b_legacy", name: "Old", category_ids: ["FOOD_AND_DRINK_GROCERIES", "travel"], is_everything_else: false },
    { id: "ee", name: "Everything Else", category_ids: ["hobbies"], is_everything_else: true },
  ];

  it("takes a category from the budget that owns it in the same view (incl. a legacy code of the same first)", () => {
    const r = plan_view_claims({ budget_id: "new", added_category_ids: ["groceries"], view_budgets: view, first_of });
    expect(r.entity!.claims).toEqual([
      { category_id: "groceries", from_budget_id: "b_food" },
      { category_id: "FOOD_AND_DRINK_GROCERIES", from_budget_id: "b_legacy" },
    ]);
  });

  it("an unowned category (or one only Everything Else lists) is a claim from nobody", () => {
    const r = plan_view_claims({ budget_id: "new", added_category_ids: ["hobbies"], view_budgets: view, first_of });
    expect(r.entity!.claims).toEqual([{ category_id: "hobbies", from_budget_id: null }]);
  });

  it("refuses to leave another budget with no categories (A3b)", () => {
    const r = plan_view_claims({ budget_id: "new", added_category_ids: ["shopping"], view_budgets: view, first_of });
    expect(r.validation_errors?.[0]).toContain('"Shopping" would have no categories left');
  });

  it("only the same view counts — another view's budgets are not passed in, so nothing is taken", () => {
    const r = plan_view_claims({ budget_id: "new", added_category_ids: ["shopping"], view_budgets: [], first_of });
    expect(r.entity!.claims).toEqual([{ category_id: "shopping", from_budget_id: null }]);
  });

  it("a budget never claims from itself", () => {
    const r = plan_view_claims({ budget_id: "b_food", added_category_ids: ["groceries"], view_budgets: view, first_of });
    expect(r.entity!.claims).toEqual([
      { category_id: "FOOD_AND_DRINK_GROCERIES", from_budget_id: "b_legacy" },
    ]);
  });
});
