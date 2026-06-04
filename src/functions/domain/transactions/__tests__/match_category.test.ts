/**
 * match_category Domain Service — Unit Tests
 */

import {
  match_category,
  CategoryRule,
  DEFAULT_CATEGORY,
} from "../match_category.service";

const rules: CategoryRule[] = [
  { category: "Groceries", merchants: ["whole foods", "trader joe's"], keywords: ["grocery", "supermarket"] },
  { category: "Coffee", merchants: ["starbucks"], keywords: ["coffee"] },
];

describe("match_category", () => {
  it("keeps an already-meaningful category", () => {
    const r = match_category(
      { plaid_match_category: "FOOD_AND_DRINK", merchant_name: "Starbucks", name: "x" },
      rules
    );
    expect(r).toEqual({ category: "FOOD_AND_DRINK", matched_by: "existing" });
  });

  it("matches by merchant (case-insensitive) when uncategorised", () => {
    const r = match_category(
      { plaid_match_category: DEFAULT_CATEGORY, merchant_name: "Whole Foods", name: "purchase" },
      rules
    );
    expect(r).toEqual({ category: "Groceries", matched_by: "merchant" });
  });

  it("falls back to a keyword substring in the name", () => {
    const r = match_category(
      { plaid_match_category: DEFAULT_CATEGORY, merchant_name: null, name: "Local Supermarket #42" },
      rules
    );
    expect(r).toEqual({ category: "Groceries", matched_by: "keyword" });
  });

  it("prefers merchant over keyword", () => {
    const r = match_category(
      // merchant Starbucks (Coffee) wins over the name keyword "grocery"
      { plaid_match_category: DEFAULT_CATEGORY, merchant_name: "Starbucks", name: "grocery run" },
      rules
    );
    expect(r.category).toBe("Coffee");
    expect(r.matched_by).toBe("merchant");
  });

  it("returns the default when nothing matches", () => {
    const r = match_category(
      { plaid_match_category: DEFAULT_CATEGORY, merchant_name: "Unknown LLC", name: "mystery" },
      rules
    );
    expect(r).toEqual({ category: DEFAULT_CATEGORY, matched_by: "default" });
  });

  it("handles null merchant + null name", () => {
    const r = match_category(
      { plaid_match_category: DEFAULT_CATEGORY, merchant_name: null, name: null },
      rules
    );
    expect(r.matched_by).toBe("default");
  });

  it("is deterministic", () => {
    const txn = { plaid_match_category: DEFAULT_CATEGORY, merchant_name: "Whole Foods", name: "x" };
    expect(match_category(txn, rules)).toEqual(match_category(txn, rules));
  });
});
