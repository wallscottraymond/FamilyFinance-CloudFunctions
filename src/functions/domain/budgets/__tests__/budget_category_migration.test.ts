import { build_category_catalog } from "../../transactions/split_category.service";
import { plan_budget_category_migration } from "../budget_category_migration.service";

const catalog = build_category_catalog([
  { id: "FOOD_AND_DRINK_GROCERIES", data: { firstCategoryId: "groceries", overallCategoryId: "food" } },
  { id: "FOOD_AND_DRINK_RESTAURANT", data: { firstCategoryId: "eating_out", overallCategoryId: "food" } },
  { id: "FOOD_AND_DRINK_FAST_FOOD", data: { firstCategoryId: "eating_out", overallCategoryId: "food" } },
]);
const b = (id: string, category_ids: string[], ee = false) => ({
  id, owner_key: "u", name: id, category_ids, is_everything_else: ee,
});

describe("plan_budget_category_migration (A2)", () => {
  it("Everything Else stores no list", () => {
    const r = plan_budget_category_migration([b("ee", ["groceries", "x"], true)], catalog);
    expect(r.changes).toEqual([{ budget_id: "ee", owner_key: "u", name: "ee", before: ["groceries", "x"], after: [] }]);
  });

  it("slugs stay; nothing to change", () => {
    expect(plan_budget_category_migration([b("g", ["groceries"])], catalog)).toEqual({ changes: [], flags: [] });
  });

  it("codes covering a whole first → its slug", () => {
    const r = plan_budget_category_migration([b("e", ["FOOD_AND_DRINK_RESTAURANT", "FOOD_AND_DRINK_FAST_FOOD"])], catalog);
    expect(r.changes[0].after).toEqual(["eating_out"]);
  });

  it("codes covering PART of a first are flagged and left as is (never widened)", () => {
    const r = plan_budget_category_migration([b("e", ["FOOD_AND_DRINK_RESTAURANT"])], catalog);
    expect(r.changes).toEqual([]);
    expect(r.flags).toEqual([{ budget_id: "e", owner_key: "u", name: "e", reason: "partial_first", ids: ["FOOD_AND_DRINK_RESTAURANT"] }]);
  });

  it("a code already covered by its slug folds into it", () => {
    const r = plan_budget_category_migration([b("e", ["eating_out", "FOOD_AND_DRINK_RESTAURANT"])], catalog);
    expect(r.changes[0].after).toEqual(["eating_out"]);
  });

  it("overall slugs / unknown ids / an empty real budget are flagged", () => {
    const r = plan_budget_category_migration([b("o", ["food"]), b("u", ["nope"]), b("s", [])], catalog);
    expect(r.flags.map((f) => f.reason)).toEqual(["overall_slug", "unknown_id", "no_categories"]);
    expect(r.changes).toEqual([]);
  });
});
