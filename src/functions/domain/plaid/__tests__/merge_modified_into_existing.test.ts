/**
 * merge_modified_into_existing — completeness proof for Plaid-Modified-Sync-Preserves-Edits.
 * One assertion per USER-OWNED field from the Phase 1 inventory (kept), per PLAID-OWNED field
 * (refreshed), plus the amount-change rules (default split absorbs; proportional fallback).
 */
/* eslint-disable @typescript-eslint/naming-convention, max-len -- Firestore doc fixtures */
import {
  merge_modified_into_existing,
  refit_split_amounts,
} from "../merge_modified_into_existing.service";

const T_OLD = "2026-09-01T00:00:00Z";
const T_NEW = "2026-09-02T00:00:00Z";

/** An existing doc carrying every kind of user edit. */
const existing = () => ({
  transactionId: "p1",
  userId: "u1",
  ownerId: "u1",
  groupIds: ["g1"],
  isPrivate: false,
  createdAt: "created",
  name: "CAFE RIO #12",
  description: "Lunch with Sam", // user rename (≠ name)
  merchantName: "Cafe Rio",
  vendorKey: "cafe rio",
  amount: 40,
  transactionDate: T_OLD,
  type: "transfer", // set by the classifier
  isPending: true,
  pendingTransactionId: null,
  plaidPrimaryCategory: "FOOD_AND_DRINK",
  plaidDetailedCategory: "FOOD_AND_DRINK_RESTAURANT",
  internalPrimaryCategory: "FOOD_AND_DRINK",
  internalDetailedCategory: "FOOD_AND_DRINK_FAST_FOOD",
  tagIds: ["tag-work"],
  needsReview: false, // the user cleared a rule's review flag
  needsNote: true,
  userNotes: "expense report",
  isHidden: true,
  initialPlaidData: { plaidName: "CAFE RIO #12" },
  splitBudgetIds: ["b-food", "b-work"],
  returnAmount: 0,
  splits: [
    {
      splitId: "s-user",
      amount: 25,
      isDefault: false,
      description: "my half",
      budgetId: "b-work",
      budgetAssignmentSource: "manual",
      outflowId: "bill-1",
      outflowAssignmentSource: "manual",
      inflowId: null,
      spendStatus: "refund",
      isIgnored: false,
      isRefund: true,
      isTaxDeductible: true,
      internalPrimaryCategory: "GENERAL_SERVICES",
      internalDetailedCategory: "GENERAL_SERVICES_OTHER",
      firstCategoryId: "services",
      secondCategoryId: "GENERAL_SERVICES_OTHER",
      categorySource: "user",
      tags: ["tag-work"],
      rules: ["rule-1"],
      plaidPrimaryCategory: "FOOD_AND_DRINK",
      plaidDetailedCategory: "FOOD_AND_DRINK_RESTAURANT",
      monthlyPeriodId: "2026M09",
      weeklyPeriodId: "2026W35",
      biWeeklyPeriodId: "2026BM09A",
      paymentDate: T_OLD,
    },
    {
      splitId: "s-default",
      amount: 15,
      isDefault: true,
      budgetId: "b-food",
      spendStatus: "ignored",
      isIgnored: true,
      isRefund: false,
      isTaxDeductible: false,
      internalPrimaryCategory: "FOOD_AND_DRINK",
      internalDetailedCategory: "FOOD_AND_DRINK_FAST_FOOD",
      categorySource: "plaid",
      tags: [],
      plaidPrimaryCategory: "FOOD_AND_DRINK",
      plaidDetailedCategory: "FOOD_AND_DRINK_RESTAURANT",
      monthlyPeriodId: "2026M09",
      paymentDate: T_OLD,
    },
  ],
});

/** What the sync builds from Plaid's "modified" payload (one fresh default split, no user state). */
const fresh = (over: Record<string, unknown> = {}) => ({
  transactionId: "p1",
  userId: "u1",
  ownerId: "u1",
  groupIds: [],
  name: "CAFE RIO #12 SLC",
  description: "CAFE RIO #12 SLC",
  merchantName: "Cafe Rio Mexican Grill",
  vendorKey: "cafe rio mexican grill",
  amount: 46,
  transactionDate: T_NEW,
  type: "expense",
  isPending: false,
  pendingTransactionId: "pend-1",
  plaidPrimaryCategory: "FOOD_AND_DRINK",
  plaidDetailedCategory: "FOOD_AND_DRINK_FAST_FOOD",
  internalPrimaryCategory: "FOOD_AND_DRINK",
  internalDetailedCategory: "FOOD_AND_DRINK_FAST_FOOD",
  tagIds: [],
  needsReview: true,
  needsNote: false,
  isActive: true,
  isDeleted: false,
  updatedAt: "now",
  initialPlaidData: { plaidName: "CAFE RIO #12 SLC" },
  splits: [
    {
      splitId: "fresh-1",
      amount: 46,
      isDefault: true,
      budgetId: "unassigned",
      isIgnored: false,
      isRefund: false,
      isTaxDeductible: false,
      internalPrimaryCategory: "FOOD_AND_DRINK",
      internalDetailedCategory: "FOOD_AND_DRINK_COFFEE",
      plaidPrimaryCategory: "FOOD_AND_DRINK",
      plaidDetailedCategory: "FOOD_AND_DRINK_FAST_FOOD",
      monthlyPeriodId: "2026M09",
      weeklyPeriodId: "2026W36",
      biWeeklyPeriodId: "2026BM09A",
      paymentDate: T_NEW,
      tags: [],
      rules: [],
    },
  ],
  ...over,
});

type Split = Record<string, unknown>;
const merged = () => merge_modified_into_existing(existing(), fresh());
const split = (doc: Record<string, unknown>, id: string): Split =>
  (doc.splits as Split[]).find((s) => s.splitId === id)!;

describe("merge_modified_into_existing — user-owned fields are KEPT", () => {
  it("keeps the user's splits (count + ids), not the fresh default split", () => {
    const out = merged();
    expect((out.splits as Split[]).map((s) => s.splitId)).toEqual(["s-user", "s-default"]);
  });

  it.each([
    ["description", "my half"],
    ["budgetId", "b-work"],
    ["budgetAssignmentSource", "manual"],
    ["outflowId", "bill-1"],
    ["outflowAssignmentSource", "manual"],
    ["spendStatus", "refund"],
    ["isRefund", true],
    ["isTaxDeductible", true],
    ["firstCategoryId", "services"],
    ["secondCategoryId", "GENERAL_SERVICES_OTHER"],
    ["categorySource", "user"],
    ["internalDetailedCategory", "GENERAL_SERVICES_OTHER"], // user override wins over Plaid's new mapping
    ["internalPrimaryCategory", "GENERAL_SERVICES"],
    ["tags", ["tag-work"]],
    ["rules", ["rule-1"]],
    ["amount", 25], // non-default split keeps its dollars
  ])("split field %s", (field, value) => {
    expect(split(merged(), "s-user")[field]).toEqual(value);
  });

  it("keeps Ignore on the default split", () => {
    const d = split(merged(), "s-default");
    expect(d.spendStatus).toBe("ignored");
    expect(d.isIgnored).toBe(true);
  });

  it.each([
    ["tagIds", ["tag-work"]],
    ["needsReview", false],
    ["needsNote", true],
    ["description", "Lunch with Sam"],
    ["type", "transfer"],
    ["groupIds", ["g1"]],
    ["isPrivate", false],
    ["userId", "u1"],
    ["ownerId", "u1"],
    ["createdAt", "created"],
    ["userNotes", "expense report"],
    ["isHidden", true],
    ["initialPlaidData", { plaidName: "CAFE RIO #12" }],
    ["splitBudgetIds", ["b-food", "b-work"]],
    ["internalDetailedCategory", "FOOD_AND_DRINK_FAST_FOOD"],
  ])("transaction field %s", (field, value) => {
    expect(merged()[field]).toEqual(value);
  });
});

describe("merge_modified_into_existing — Plaid-owned fields are REFRESHED", () => {
  it.each([
    ["amount", 46],
    ["transactionDate", T_NEW],
    ["name", "CAFE RIO #12 SLC"],
    ["merchantName", "Cafe Rio Mexican Grill"],
    ["vendorKey", "cafe rio mexican grill"],
    ["plaidDetailedCategory", "FOOD_AND_DRINK_FAST_FOOD"],
    ["isPending", false],
    ["pendingTransactionId", "pend-1"],
    ["isActive", true],
    ["updatedAt", "now"],
  ])("transaction field %s", (field, value) => {
    expect(merged()[field]).toEqual(value);
  });

  it("refreshes Plaid-owned split fields on every split", () => {
    for (const id of ["s-user", "s-default"]) {
      const s = split(merged(), id);
      expect(s.plaidDetailedCategory).toBe("FOOD_AND_DRINK_FAST_FOOD");
      expect(s.weeklyPeriodId).toBe("2026W36");
      expect(s.paymentDate).toBe(T_NEW);
    }
  });

  it("an untouched split takes Plaid's new category mapping", () => {
    expect(split(merged(), "s-default").internalDetailedCategory).toBe("FOOD_AND_DRINK_COFFEE");
  });

  it("takes Plaid's description when the user never renamed it", () => {
    const e = { ...existing(), description: "CAFE RIO #12" }; // == name → not a rename
    expect(merge_modified_into_existing(e, fresh()).description).toBe("CAFE RIO #12 SLC");
  });
});

describe("amount changes", () => {
  it("the default split absorbs the difference (40 → 46)", () => {
    const out = merged();
    expect(split(out, "s-user").amount).toBe(25);
    expect(split(out, "s-default").amount).toBe(21);
    expect(out.totalAllocated).toBe(46);
  });

  it("falls back to proportional when the default would go negative (40 → 20)", () => {
    const out = merge_modified_into_existing(existing(), fresh({ amount: 20 }));
    const amounts = (out.splits as Split[]).map((s) => s.amount as number);
    expect(amounts.reduce((a, b) => a + b, 0)).toBeCloseTo(20);
    expect(split(out, "s-user").amount).toBe(12.5);
    expect(split(out, "s-default").amount).toBe(7.5);
  });

  it("no default split → proportional, totals exact after rounding", () => {
    const out = refit_split_amounts(
      [{ splitId: "a", amount: 10 }, { splitId: "b", amount: 10 }, { splitId: "c", amount: 10 }],
      10
    );
    expect(out.reduce((s, sp) => s + (sp.amount as number), 0)).toBeCloseTo(10, 10);
  });

  it("unchanged amount leaves splits untouched", () => {
    const out = merge_modified_into_existing(existing(), fresh({ amount: 40 }));
    expect(split(out, "s-default").amount).toBe(15);
  });

  it("recomputes returnAmount from the kept refund split", () => {
    expect(merged().returnAmount).toBe(25);
  });
});

describe("edge cases", () => {
  it("existing doc without splits → fresh doc (keeps createdAt)", () => {
    const out = merge_modified_into_existing({ ...existing(), splits: [] }, fresh());
    expect((out.splits as Split[])[0].splitId).toBe("fresh-1");
    expect(out.createdAt).toBe("created");
  });

  it("is deterministic and doesn't mutate its inputs", () => {
    const e = existing();
    const f = fresh();
    const snapshot = JSON.stringify([e, f]);
    expect(merge_modified_into_existing(e, f)).toEqual(merge_modified_into_existing(e, f));
    expect(JSON.stringify([e, f])).toBe(snapshot);
  });
});
