/**
 * legacy_category_backfill (3-0b) — old overrides become user picks; legacy fields cleared. Pure.
 */

import { build_category_catalog } from "../split_category.service";
import {
  backfill_legacy_split_categories,
  legacy_txn_fields_to_clear,
} from "../legacy_category_backfill.service";

const catalog = build_category_catalog([
  { id: "FOOD_AND_DRINK_GROCERIES", data: { overallCategoryId: "food", firstCategoryId: "groceries" } },
  { id: "GENERAL_MERCHANDISE_SUPERSTORES", data: { overallCategoryId: "shopping", firstCategoryId: "shopping" } },
]);

const base = {
  splitId: "s1",
  plaidDetailedCategory: "GENERAL_MERCHANDISE_SUPERSTORES",
  categorySource: "plaid",
  firstCategoryId: "shopping",
};

describe("backfill_legacy_split_categories", () => {
  it("the live case: superstores → 'groceries' override becomes a user pick", () => {
    const r = backfill_legacy_split_categories(
      [{ ...base, internalDetailedCategory: "groceries", internalPrimaryCategory: null }],
      catalog
    );
    expect(r.changed).toBe(true);
    expect(r.picks_carried).toBe(1);
    expect(r.splits[0]).toMatchObject({
      categorySource: "user",
      firstCategoryId: "groceries",
      overallCategoryId: "food",
      secondCategoryId: null,
      internalDetailedCategory: null,
      internalPrimaryCategory: null,
    });
  });

  it("a copy that agrees with Plaid is cleared, the split stays Plaid's", () => {
    const r = backfill_legacy_split_categories(
      [{ ...base, internalDetailedCategory: "GENERAL_MERCHANDISE_SUPERSTORES" }],
      catalog
    );
    expect(r.changed).toBe(true);
    expect(r.picks_carried).toBe(0);
    expect(r.splits[0]).toMatchObject({ categorySource: "plaid", internalDetailedCategory: null });
  });

  it("an existing user pick wins over a stale legacy value (which is cleared)", () => {
    const r = backfill_legacy_split_categories(
      [{ ...base, categorySource: "user", firstCategoryId: "shopping", internalDetailedCategory: "groceries" }],
      catalog
    );
    expect(r.splits[0]).toMatchObject({ categorySource: "user", firstCategoryId: "shopping", internalDetailedCategory: null });
    expect(r.picks_carried).toBe(0);
  });

  it("nothing legacy → unchanged (same array, no write)", () => {
    const splits = [{ ...base, internalDetailedCategory: null, internalPrimaryCategory: null }];
    const r = backfill_legacy_split_categories(splits, catalog);
    expect(r.changed).toBe(false);
    expect(r.splits).toBe(splits);
  });
});

describe("legacy_txn_fields_to_clear", () => {
  it("clears transaction-level legacy fields only when set", () => {
    expect(legacy_txn_fields_to_clear({ internalPrimaryCategory: "X" })).toEqual({
      internalDetailedCategory: null,
      internalPrimaryCategory: null,
    });
    expect(legacy_txn_fields_to_clear({})).toEqual({});
  });
});
