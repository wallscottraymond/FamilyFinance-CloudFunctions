/**
 * split_category — the ONE category function (Category & Mapping Canon M7). Pure, no mocks.
 *
 * Order: user / rule pick → merchant & keyword rules → Plaid code → collection → Other.
 * Includes the Transaction-Integrity-Review worked examples (Mous, Santo Taco).
 */

import {
  build_category_catalog,
  budget_first_ids,
  resolve_split_category,
} from "../split_category.service";
import { match_budget, BudgetForMatch } from "../match_budget.service";

const catalog = build_category_catalog([
  {
    id: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
    data: { overallCategoryId: "shopping", firstCategoryId: "shopping" },
  },
  {
    id: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
    data: { overallCategoryId: "shopping", firstCategoryId: "shopping" },
  },
  {
    id: "FOOD_AND_DRINK_RESTAURANT",
    data: { overallCategoryId: "food_and_drink", firstCategoryId: "eating_out" },
  },
  {
    id: "FOOD_AND_DRINK_FAST_FOOD",
    data: { overallCategoryId: "food_and_drink", firstCategoryId: "eating_out", merchants: ["santo taco"] },
  },
  {
    id: "FOOD_AND_DRINK_GROCERIES",
    data: { overallCategoryId: "food_and_drink", firstCategoryId: "groceries" },
  },
  {
    id: "TRANSFER_OUT_ACCOUNT_TRANSFER",
    data: { overallCategoryId: "transfers", firstCategoryId: "transfer_out" },
  },
  {
    id: "INCOME_WAGES",
    data: { overallCategoryId: "income", firstCategoryId: "paycheck" },
  },
  { id: "OTHER_EXPENSE", data: { overallCategoryId: "other", firstCategoryId: "other" } },
]);

const JUN = Date.UTC(2026, 5, 15);
function budget(id: string, category_ids: string[]): BudgetForMatch {
  return {
    id,
    category_ids,
    first_ids: budget_first_ids(category_ids, catalog),
    start_ms: Date.UTC(2026, 0, 1),
    end_ms: null,
    is_ongoing: true,
    cadence: "monthly",
  };
}
const EE = "ee";

describe("resolve_split_category", () => {
  it("Mous: a general-merchandise code resolves to Shopping (not Hobbies)", () => {
    const r = resolve_split_category(
      { plaid_detailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE", merchant_name: "Mous" },
      catalog
    );
    expect(r.first_category_id).toBe("shopping");
    expect(r.category_source).toBe("plaid");
    // …and a slug-only Shopping budget claims it.
    const shopping = budget("b_shop", ["shopping"]);
    expect(match_budget(r, JUN, [shopping], EE).budget_id).toBe("b_shop");
  });

  it("Mous with an EMPTY Shopping budget falls to Everything Else (no category owns it)", () => {
    const r = resolve_split_category(
      { plaid_detailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE" },
      catalog
    );
    expect(match_budget(r, JUN, [budget("b_shop", [])], EE).budget_id).toBe(EE);
  });

  it("Santo Taco: an unresolved code is upgraded by the collection's merchant rule", () => {
    const r = resolve_split_category(
      { plaid_detailed: "OTHER_EXPENSE", merchant_name: "Santo Taco" },
      catalog
    );
    expect(r.semantic_code).toBe("FOOD_AND_DRINK_FAST_FOOD");
    expect(r.first_category_id).toBe("eating_out");
    expect(match_budget(r, JUN, [budget("b_eat", ["eating_out"])], EE).budget_id).toBe("b_eat");
  });

  it("merchant rules never override a code Plaid already resolved", () => {
    const r = resolve_split_category(
      { plaid_detailed: "FOOD_AND_DRINK_GROCERIES", merchant_name: "Santo Taco" },
      catalog
    );
    expect(r.first_category_id).toBe("groceries");
  });

  it("a user (or rule) pick wins over Plaid and never ranks the original code", () => {
    const r = resolve_split_category(
      {
        plaid_detailed: "FOOD_AND_DRINK_GROCERIES",
        category_source: "user",
        first_category_id: "eating_out",
      },
      catalog
    );
    expect(r.first_category_id).toBe("eating_out");
    expect(r.overall_category_id).toBe("food_and_drink");
    expect(r.match_keys).not.toContain("FOOD_AND_DRINK_GROCERIES");
    // A budget still holding the original code can't beat the pick.
    const groceriesByCode = budget("b_gro", ["FOOD_AND_DRINK_GROCERIES"]);
    const eatingOut = budget("b_eat", ["eating_out"]);
    expect(match_budget(r, JUN, [groceriesByCode, eatingOut], EE).budget_id).toBe("b_eat");
  });

  it("a user pick lands in a LEGACY budget that stores Plaid codes of that first", () => {
    const r = resolve_split_category(
      { plaid_detailed: "OTHER_EXPENSE", category_source: "user", first_category_id: "eating_out" },
      catalog
    );
    const legacy = budget("b_legacy", ["FOOD_AND_DRINK_RESTAURANT"]);
    expect(match_budget(r, JUN, [legacy], EE).budget_id).toBe("b_legacy");
  });

  it("a user pick away from a transfer gives it spending meaning", () => {
    const r = resolve_split_category(
      {
        plaid_detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
        category_source: "user",
        first_category_id: "shopping",
      },
      catalog
    );
    expect(r.semantic_code.startsWith("TRANSFER")).toBe(false);
    expect(r.semantic_code.startsWith("GENERAL_MERCHANDISE")).toBe(true);
  });

  it("an untouched transfer keeps its transfer meaning", () => {
    const r = resolve_split_category({ plaid_detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" }, catalog);
    expect(r.semantic_code).toBe("TRANSFER_OUT_ACCOUNT_TRANSFER");
  });

  it("an unmapped or missing code falls to Other, never null (C7)", () => {
    for (const code of ["SOMETHING_NEW", null]) {
      const r = resolve_split_category({ plaid_detailed: code }, catalog);
      expect(r.first_category_id).toBe("other");
      expect(r.overall_category_id).toBe("other");
    }
  });

  it("a 'user' source with no slug is treated as Plaid (nothing to pin)", () => {
    const r = resolve_split_category(
      { plaid_detailed: "FOOD_AND_DRINK_GROCERIES", category_source: "user" },
      catalog
    );
    expect(r.category_source).toBe("plaid");
    expect(r.first_category_id).toBe("groceries");
  });

  it("a second-level pin resolves first / overall from the collection", () => {
    const r = resolve_split_category(
      {
        plaid_detailed: "OTHER_EXPENSE",
        category_source: "user",
        second_category_id: "FOOD_AND_DRINK_RESTAURANT",
      },
      catalog
    );
    expect(r.first_category_id).toBe("eating_out");
    expect(r.semantic_code).toBe("FOOD_AND_DRINK_RESTAURANT");
  });

  it("legacy internal* fields are not an input (canon M2)", () => {
    const r = resolve_split_category(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { plaid_detailed: "FOOD_AND_DRINK_GROCERIES", internalDetailedCategory: "shopping" } as any,
      catalog
    );
    expect(r.first_category_id).toBe("groceries");
  });

  it("is deterministic regardless of doc order", () => {
    const reversed = build_category_catalog(
      [
        { id: "B_CODE", data: { firstCategoryId: "x", overallCategoryId: "o" } },
        { id: "A_CODE", data: { firstCategoryId: "x", overallCategoryId: "o" } },
      ]
    );
    expect(reversed.plaid_by_first.x).toBe("A_CODE");
  });
});

describe("budget_first_ids", () => {
  it("maps slugs AND legacy codes to the firsts they cover", () => {
    expect(
      budget_first_ids(["FOOD_AND_DRINK_RESTAURANT", "groceries", "UNKNOWN"], catalog).sort()
    ).toEqual(["eating_out", "groceries"]);
  });
});
