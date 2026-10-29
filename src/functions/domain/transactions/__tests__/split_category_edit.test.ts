/**
 * split_category_edit — what a split edit stores in the category fields. Pure, no mocks.
 */

import { build_category_catalog } from "../split_category.service";
import {
  legacy_override_first,
  resolve_split_category_edit,
  split_category_input_from_raw,
} from "../split_category_edit.service";

const catalog = build_category_catalog([
  {
    id: "FOOD_AND_DRINK_GROCERIES",
    data: { overallCategoryId: "food_and_drink", firstCategoryId: "groceries", first_category: "Groceries" },
  },
  {
    id: "FOOD_AND_DRINK_RESTAURANT",
    data: { overallCategoryId: "food_and_drink", firstCategoryId: "eating_out", first_category: "Eating Out and Snacks" },
  },
  {
    id: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
    data: { overallCategoryId: "shopping", firstCategoryId: "shopping", first_category: "Shopping" },
  },
  { id: "OTHER_EXPENSE", data: { overallCategoryId: "other", firstCategoryId: "other", first_category: "Other" } },
]);

const stored = {
  splitId: "s1",
  plaidPrimaryCategory: "FOOD_AND_DRINK",
  plaidDetailedCategory: "FOOD_AND_DRINK_GROCERIES",
  categorySource: "plaid",
  firstCategoryId: "groceries",
  overallCategoryId: "food_and_drink",
  categoryId: "groceries",
};
const txn = { splits: [stored] };

describe("resolve_split_category_edit", () => {
  it("re-saving an untouched split changes nothing (Plaid keeps updating it)", () => {
    const r = resolve_split_category_edit({ ...stored }, stored, txn, catalog);
    expect(r.categorySource).toBe("plaid");
    expect(r.firstCategoryId).toBe("groceries");
    expect(r.internalDetailedCategory).toBeNull();
  });

  it("the new app's explicit pick is stored as a user pick", () => {
    const r = resolve_split_category_edit(
      { ...stored, categorySource: "user", firstCategoryId: "eating_out" },
      stored,
      txn,
      catalog
    );
    expect(r).toMatchObject({
      categorySource: "user",
      firstCategoryId: "eating_out",
      overallCategoryId: "food_and_drink",
      secondCategoryId: null,
      plaidDetailedCategory: "FOOD_AND_DRINK_GROCERIES", // immutable (M1)
    });
  });

  it("an unknown slug is never stored", () => {
    const r = resolve_split_category_edit(
      { ...stored, categorySource: "user", firstCategoryId: "made_up" },
      stored,
      txn,
      catalog
    );
    expect(r.categorySource).toBe("plaid");
    expect(r.firstCategoryId).toBe("groceries");
  });

  it("'use auto' resets a user pick to Plaid", () => {
    const picked = { ...stored, categorySource: "user", firstCategoryId: "shopping" };
    const r = resolve_split_category_edit({ ...picked, categorySource: "plaid" }, picked, txn, catalog);
    expect(r.categorySource).toBe("plaid");
    expect(r.firstCategoryId).toBe("groceries");
  });

  it("an existing user pick is kept on a re-save", () => {
    const picked = { ...stored, categorySource: "user", firstCategoryId: "shopping" };
    const r = resolve_split_category_edit({ ...picked }, picked, txn, catalog);
    expect(r.categorySource).toBe("user");
    expect(r.firstCategoryId).toBe("shopping");
  });

  it("old builds: a CHANGED bare categoryId (slug) becomes a user pick", () => {
    const r = resolve_split_category_edit({ ...stored, categoryId: "shopping" }, stored, txn, catalog);
    expect(r.categorySource).toBe("user");
    expect(r.firstCategoryId).toBe("shopping");
  });

  it("old builds: a CHANGED bare categoryId (Plaid code) becomes a FIRST pick", () => {
    const r = resolve_split_category_edit(
      { ...stored, categoryId: "FOOD_AND_DRINK_RESTAURANT" },
      stored,
      txn,
      catalog
    );
    expect(r).toMatchObject({ categorySource: "user", firstCategoryId: "eating_out", secondCategoryId: null });
  });

  it("old builds: a categoryId that means the SAME first is not a pick", () => {
    const r = resolve_split_category_edit(
      { ...stored, categoryId: "FOOD_AND_DRINK_GROCERIES" },
      stored,
      txn,
      catalog
    );
    expect(r.categorySource).toBe("plaid");
  });

  it("old builds: the 'other' default is never a pick", () => {
    const r = resolve_split_category_edit({ ...stored, categoryId: "other" }, stored, txn, catalog);
    expect(r.categorySource).toBe("plaid");
  });

  it("a NEW split inherits the transaction's Plaid codes", () => {
    const r = resolve_split_category_edit({ splitId: "s2", amount: 5 }, undefined, txn, catalog);
    expect(r.plaidDetailedCategory).toBe("FOOD_AND_DRINK_GROCERIES");
    expect(r.firstCategoryId).toBe("groceries");
  });

  it("a NEW split with a picked category from an old build is a user pick", () => {
    const r = resolve_split_category_edit({ splitId: "s2", categoryId: "eating_out" }, undefined, txn, catalog);
    expect(r).toMatchObject({ categorySource: "user", firstCategoryId: "eating_out" });
  });

  it("a client can't rewrite the Plaid codes of an existing split (M1)", () => {
    const r = resolve_split_category_edit(
      { ...stored, plaidDetailedCategory: "OTHER_EXPENSE" },
      stored,
      txn,
      catalog
    );
    expect(r.plaidDetailedCategory).toBe("FOOD_AND_DRINK_GROCERIES");
  });

  it("a legacy override (pre-backfill) is kept as the user's pick on an edit", () => {
    const legacy = { ...stored, internalDetailedCategory: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE" };
    const r = resolve_split_category_edit({ ...legacy }, legacy, txn, catalog);
    expect(r).toMatchObject({ categorySource: "user", firstCategoryId: "shopping", internalDetailedCategory: null });
  });
});

describe("legacy_override_first", () => {
  it("reads a Plaid code, a slug, or an old rule's display name", () => {
    expect(legacy_override_first({ ...stored, internalDetailedCategory: "FOOD_AND_DRINK_RESTAURANT" }, catalog)).toBe("eating_out");
    expect(legacy_override_first({ ...stored, internalDetailedCategory: "shopping" }, catalog)).toBe("shopping");
    expect(legacy_override_first({ ...stored, internalPrimaryCategory: "Eating Out and Snacks" }, catalog)).toBe("eating_out");
  });

  it("ignores an override that agrees with Plaid, an unknown one, or a split already picked", () => {
    expect(legacy_override_first({ ...stored, internalDetailedCategory: "groceries" }, catalog)).toBeNull();
    expect(legacy_override_first({ ...stored, internalDetailedCategory: "Nope" }, catalog)).toBeNull();
    expect(
      legacy_override_first({ ...stored, categorySource: "user", internalDetailedCategory: "shopping" }, catalog)
    ).toBeNull();
  });
});

describe("an unreadable stored pick (retired slug)", () => {
  const retired = { ...stored, categorySource: "user", firstCategoryId: "retired_slug" };
  it("is kept on an unrelated edit (e.g. a status tap re-sends the split)", () => {
    const r = resolve_split_category_edit({ ...retired, spendStatus: "ignored" }, retired, txn, catalog);
    expect(r).toMatchObject({ categorySource: "user", firstCategoryId: "retired_slug" });
  });
  it("\"use auto\" still resets it to Plaid", () => {
    const r = resolve_split_category_edit({ ...retired, categorySource: "plaid" }, retired, txn, catalog);
    expect(r).toMatchObject({ categorySource: "plaid", firstCategoryId: "groceries" });
  });
});

describe("legacy_override_first — a 'user' source with no usable slug", () => {
  it("reads the legacy field (an old reclassify that only wrote internal*)", () => {
    expect(
      legacy_override_first(
        { ...stored, categorySource: "user", firstCategoryId: null, internalDetailedCategory: "shopping" },
        catalog
      )
    ).toBe("shopping");
  });
});

describe("split_category_input_from_raw — THE raw-split mapper", () => {
  it("reads canonical fields + the transaction's merchant / name", () => {
    expect(
      split_category_input_from_raw(
        { ...stored, categorySource: "user", firstCategoryId: "shopping" },
        { merchantName: "Mous", name: "MOUS INC" },
        catalog
      )
    ).toEqual({
      plaid_detailed: "FOOD_AND_DRINK_GROCERIES",
      category_source: "user",
      first_category_id: "shopping",
      overall_category_id: "food_and_drink",
      second_category_id: null,
      merchant_name: "Mous",
      name: "MOUS INC",
    });
  });

  it("an old override in the legacy field reads as the user's pick (engine == derive)", () => {
    const r = split_category_input_from_raw(
      { ...stored, internalDetailedCategory: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE" },
      {},
      catalog
    );
    expect(r).toMatchObject({ category_source: "user", first_category_id: "shopping" });
  });
});
