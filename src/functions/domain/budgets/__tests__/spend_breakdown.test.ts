/**
 * spend_breakdown — fee-kind mapping (Plaid BANK_FEES_* → kind).
 */

import { fee_kind_of, split_fee_kind } from "../spend_breakdown.service";

describe("fee_kind_of", () => {
  it.each([
    ["BANK_FEES_ATM_FEES", "atm"],
    ["BANK_FEES_LATE_FEES", "late"],
    ["BANK_FEES_LATE_PAYMENT", "late"],
    ["BANK_FEES_OVERDRAFT_FEES", "overdraft"],
    ["BANK_FEES_INSUFFICIENT_FUNDS", "overdraft"],
    ["BANK_FEES_FOREIGN_TRANSACTION_FEES", "foreign"],
    ["BANK_FEES_INTEREST_CHARGE", "other"],
    ["BANK_FEES_OTHER_BANK_FEES", "other"],
  ])("%s → %s", (code, kind) => {
    expect(fee_kind_of(code)).toBe(kind);
  });

  it("is null for non-fee codes", () => {
    expect(fee_kind_of("FOOD_AND_DRINK_COFFEE")).toBeNull();
    expect(fee_kind_of("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")).toBeNull();
    expect(fee_kind_of(null)).toBeNull();
  });
});

describe("split_fee_kind", () => {
  const plaid = (code: string) =>
    ({ semantic_code: code, category_source: "plaid" as const, second_category_id: null });

  it("uses the resolved code for a Plaid-categorized split", () => {
    expect(split_fee_kind(plaid("BANK_FEES_ATM_FEES"), "BANK_FEES_ATM_FEES")).toBe("atm");
    expect(split_fee_kind(plaid("GENERAL_MERCHANDISE_OTHER"), "BANK_FEES_ATM_FEES")).toBeNull();
  });

  it("a user pick of Bank Fees (no detail) takes Plaid's own fee code, else other", () => {
    const pick = { semantic_code: "BANK_FEES_ATM_FEES", category_source: "user" as const, second_category_id: null };
    expect(split_fee_kind(pick, "BANK_FEES_OVERDRAFT_FEES")).toBe("overdraft");
    expect(split_fee_kind(pick, "FOOD_AND_DRINK_COFFEE")).toBe("other");
  });

  it("a user pick to a specific fee detail uses that detail", () => {
    const pick = { semantic_code: "BANK_FEES_FOREIGN_TRANSACTION_FEES", category_source: "user" as const,
      second_category_id: "BANK_FEES_FOREIGN_TRANSACTION_FEES" };
    expect(split_fee_kind(pick, "BANK_FEES_ATM_FEES")).toBe("foreign");
  });
});

import { build_category_catalog } from "../../transactions/split_category.service";
import { map_raw_split_to_on_read_match } from "../../../resolvers/shared/on_read_matching";
import { stored_split_for_spend } from "../../../resolvers/budgets/budget_spend.resolver";

describe("raw split → breakdown fields (no extra reads: from the loaded transaction)", () => {
  const catalog = build_category_catalog([
    { id: "BANK_FEES_ATM_FEES", data: { firstCategoryId: "bank_fees", overallCategoryId: "o_fees" } },
    { id: "BANK_FEES_OVERDRAFT_FEES", data: { firstCategoryId: "bank_fees", overallCategoryId: "o_fees" } },
    { id: "FOOD_AND_DRINK_COFFEE", data: { firstCategoryId: "coffee", overallCategoryId: "o_food" } },
    { id: "OTHER_EXPENSE", data: { firstCategoryId: "other", overallCategoryId: "o_other" } },
  ]);
  const ctx = { txn_date_ms: 0, is_pending: false, is_transfer: false, is_income: false };

  it("uses the stored vendorKey, else the vendor_key function; name = cleaned merchant else txn name", () => {
    const stored = map_raw_split_to_on_read_match({ amount: 5, plaidDetailedCategory: "FOOD_AND_DRINK_COFFEE" },
      { ...ctx, merchant_name: "Starbucks", name: "STARBUCKS #123", vendor_key: "starbucks" }, catalog);
    expect(stored).toMatchObject({ vendor_key: "starbucks", place_name: "Starbucks", fee_kind: null });
    const computed = map_raw_split_to_on_read_match({ amount: 5, plaidDetailedCategory: "FOOD_AND_DRINK_COFFEE" },
      { ...ctx, merchant_name: null, name: "POS DEBIT JOE'S COFFEE #947 MAIN" }, catalog);
    expect(computed).toMatchObject({ vendor_key: "joe's coffee", place_name: "JOE'S COFFEE" });
    const nameless = map_raw_split_to_on_read_match({ amount: 5 }, { ...ctx }, catalog);
    expect(nameless).toMatchObject({ vendor_key: null, place_name: null });
  });

  it("tags BANK_FEES splits with their kind (on-read and stored paths agree)", () => {
    const raw = { amount: 3, plaidDetailedCategory: "BANK_FEES_ATM_FEES", budgetId: "ee" };
    const txn = { merchantName: "Chase", name: "ATM FEE", vendorKey: "chase" };
    expect(map_raw_split_to_on_read_match(raw, { ...ctx, merchant_name: "Chase" }, catalog).fee_kind).toBe("atm");
    const s = stored_split_for_spend(raw, txn, "ee", "monthly", catalog, ctx);
    expect(s).toMatchObject({ fee_kind: "atm", vendor_key: "chase", place_name: "Chase" });
  });
});
