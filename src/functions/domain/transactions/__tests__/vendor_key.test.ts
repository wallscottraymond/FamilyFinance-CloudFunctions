/**
 * vendor_key — the stored same-vendor key (Transaction-Detail-Redesign).
 * PARITY: the same table lives in FamilyFinanceMobile
 * features/budgets/utils/__tests__/vendorComparison.test.ts; both must pass so Budget
 * Detail's vendor chart and the stored key agree.
 */
import { vendor_key, vendor_key_from_name } from "../vendor_key.service";

/* eslint-disable max-len */
const PARITY_TABLE: Array<[string, string]> = [["Cafe Rio","cafe rio"],["AMAZON MKTPL","amazon mktpl"],["Amazon","amazon"],["POS DEBIT SMITHS FOOD #4123 SLC UT","smiths food"],["DEBIT CARD PURCHASE COSTCO WHSE #0947","costco whse"],["PURCHASE AUTHORIZED ON 09/14 SHELL OIL 57444 UT685612 card 1234","shell oil 57444"],["NETFLIX.COM 09/22","netflix.com"],["Comcast 800-266-2278","comcast"],["  Starbucks   Coffee  ","starbucks coffee"],["WAL-MART #3241","wal-mart"],["","unknown"],["   ","unknown"],["#1234","#1234"],["Target T-1234","target t-1234"],["SQ *BLUE COPPER 10/01/2026","sq *blue copper"]];
/* eslint-enable max-len */

describe("vendor_key_from_name (parity with mobile vendorKey)", () => {
  it.each(PARITY_TABLE)("%j → %j", (raw, expected) => {
    expect(vendor_key_from_name(raw)).toBe(expected);
  });
});

describe("vendor_key (transaction fields)", () => {
  it("prefers the merchant name", () => {
    expect(vendor_key({ merchant_name: "Cafe Rio", name: "CAFE RIO #12 SLC" })).toBe("cafe rio");
  });
  it("falls back to name, then description", () => {
    expect(vendor_key({ merchant_name: null, name: "POS DEBIT SMITHS FOOD #4123" })).toBe("smiths food");
    expect(vendor_key({ merchant_name: "", name: "  ", description: "Farmers Market" })).toBe("farmers market");
  });
  it("is null when there is no usable name", () => {
    expect(vendor_key({ merchant_name: null, name: null, description: "  " })).toBeNull();
    expect(vendor_key({})).toBeNull();
  });
});

describe("vendorKey writes are cosmetic to the transaction trigger", () => {
  // The backfill (and any later vendorKey refresh) must not enqueue assignment or spend work.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const guard = require("../assignment_field_guard.service");
  const base = {
    transactionDate: 1, amount: 10, isActive: true, merchantName: "Cafe Rio", name: "CAFE RIO",
    isPending: false, type: "expense",
    splits: [{ splitId: "s1", amount: 10, budgetId: "b1", spendStatus: "counted" }],
  };
  it("adding vendorKey is neither assignment- nor spend-relevant", () => {
    const after = { ...base, vendorKey: "cafe rio" };
    expect(guard.is_assignment_relevant_change(base, after)).toBe(false);
    expect(guard.is_spend_relevant_change(base, after)).toBe(false);
  });
});

describe("Plaid transformer stamps vendor_key (new syncs, modified, pending → posted)", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { transform_legacy_to_persistence } = require("../../../integrations/plaid/legacy_transaction_transformer");
  const legacy = (over: Record<string, unknown>) => ({
    transactionId: "p1", plaidItemId: "i1", accountId: "a1", currency: "USD",
    transactionDate: { toDate: () => new Date("2026-10-01T00:00:00Z") },
    name: "POS DEBIT SMITHS FOOD #4123", merchantName: null, type: "expense",
    splits: [{ splitId: "s1", amount: 12, budgetId: "unassigned", paymentDate: { toDate: () => new Date() } }],
    ...over,
  });
  it("uses the cleaned name when there's no merchant", () => {
    const [out] = transform_legacy_to_persistence([legacy({})], "u1", []);
    expect(out.vendor_key).toBe("smiths food");
  });
  it("prefers the merchant name", () => {
    const [out] = transform_legacy_to_persistence([legacy({ merchantName: "Smith's" })], "u1", []);
    expect(out.vendor_key).toBe("smith's");
  });
});
