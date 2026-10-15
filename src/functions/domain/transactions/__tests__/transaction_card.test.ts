import { Timestamp } from "firebase-admin/firestore";
import { to_card_transaction } from "../transaction_card.service";

describe("to_card_transaction", () => {
  const date = Timestamp.fromMillis(Date.UTC(2026, 9, 9, 12));
  const doc = {
    transactionId: "plaid_abc",
    ownerId: "u1",
    accountId: "a1",
    amount: 120,
    transactionDate: date,
    isPending: false,
    merchantName: "Costco",
    type: "expense",
    tagIds: ["t1"],
    userNotes: "party",
    initialPlaidData: { huge: "x".repeat(5000) },
    vendorKey: "costco",
    splits: [
      {
        splitId: "s1",
        amount: 80,
        isDefault: true,
        firstCategoryId: "groceries",
        monthlyBudgetId: "b_groc",
        spendStatus: "counted",
        createdAt: date,
        plaidRaw: { a: 1 },
      },
      { id: "s2", amount: 40, outflowId: "bill1", outflowAssignmentSource: "manual" },
    ],
  };

  it("uses the DOC id, never the Plaid id", () => {
    expect(to_card_transaction("doc_1", doc).id).toBe("doc_1");
  });

  it("turns Timestamps into millis (a callable can't send a Timestamp)", () => {
    expect(to_card_transaction("doc_1", doc).transactionDate).toBe(date.toMillis());
  });

  it("keeps the fields the transaction row renders", () => {
    const card = to_card_transaction("doc_1", doc);
    expect(card).toMatchObject({
      ownerId: "u1",
      accountId: "a1",
      amount: 120,
      isPending: false,
      merchantName: "Costco",
      type: "expense",
      tagIds: ["t1"],
      userNotes: "party",
    });
    expect(card.splits).toEqual([
      {
        splitId: "s1",
        amount: 80,
        isDefault: true,
        firstCategoryId: "groceries",
        monthlyBudgetId: "b_groc",
        spendStatus: "counted",
      },
      { id: "s2", amount: 40, outflowId: "bill1", outflowAssignmentSource: "manual" },
    ]);
  });

  it("drops everything else (raw Plaid data, vendor key, split extras)", () => {
    const card = to_card_transaction("doc_1", doc);
    expect(card).not.toHaveProperty("initialPlaidData");
    expect(card).not.toHaveProperty("vendorKey");
    expect(card).not.toHaveProperty("transactionId");
    expect((card.splits as Array<Record<string, unknown>>)[0]).not.toHaveProperty("plaidRaw");
    expect((card.splits as Array<Record<string, unknown>>)[0]).not.toHaveProperty("createdAt");
  });

  it("handles a doc without splits", () => {
    expect(to_card_transaction("d", { amount: 5 }).splits).toEqual([]);
  });
});
