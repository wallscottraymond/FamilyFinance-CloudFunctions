/**
 * format_transactions — a failure must reach the sync, never shrink the list (Code-Health-Review P2-H2).
 *
 * The sync saves the Plaid cursor only when nothing failed. format_transactions used to swallow
 * errors and return a partial (often empty) list, so the sync wrote nothing, saved the cursor,
 * and those transactions were never pulled again.
 */
let mock_split_seq = 0;
jest.mock("../../../../index", () => ({
  db: { collection: () => ({ doc: () => ({ id: `split_${++mock_split_seq}` }) }) },
}));

const mock_query = jest.fn();
jest.mock("../../../../utils/firestore", () => ({
  queryDocuments: (...args: unknown[]) => mock_query(...args),
}));

import { Transaction as PlaidTransaction } from "plaid";
import { format_transactions } from "../format_transactions";

const txn = (i: number, account_id: string): PlaidTransaction => ({
  transaction_id: `t${i}`,
  account_id,
  amount: 10 + i,
  date: "2026-10-01",
  name: `Shop ${i}`,
  merchant_name: `Shop ${i}`,
  pending: false,
  personal_finance_category: { primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_OTHER" },
} as unknown as PlaidTransaction);

/** Behaves like Firestore: an `in` filter takes at most 30 values. */
function accounts_query(known: Set<string>) {
  return async (_collection: string, opts: { where: Array<{ field: string; operator: string; value: unknown }> }) => {
    const in_clause = opts.where.find((w) => w.operator === "in")!;
    const ids = in_clause.value as string[];
    if (ids.length > 30) throw new Error("INVALID_ARGUMENT: 'IN' supports up to 30 comparison values");
    return ids.filter((id) => known.has(id)).map((id) => ({ id: `doc_${id}`, accountId: id, name: "Checking" }));
  };
}

describe("format_transactions", () => {
  beforeEach(() => mock_query.mockReset());

  it("maps every transaction across more than 30 accounts (query is chunked)", async () => {
    const ids = Array.from({ length: 35 }, (_, i) => `acct_${i}`);
    mock_query.mockImplementation(accounts_query(new Set(ids)));

    const out = await format_transactions(ids.map((a, i) => txn(i, a)), "item_1", "u1", undefined, "USD");

    expect(out).toHaveLength(35);
    for (const call of mock_query.mock.calls) {
      expect((call[1].where.find((w: { operator: string }) => w.operator === "in").value as string[]).length)
        .toBeLessThanOrEqual(30);
    }
  });

  it("rejects when the accounts query fails (instead of returning [])", async () => {
    mock_query.mockRejectedValue(new Error("UNAVAILABLE"));
    await expect(
      format_transactions([txn(1, "acct_1")], "item_1", "u1", undefined, "USD")
    ).rejects.toThrow("UNAVAILABLE");
  });

  it("rejects when a transaction's account is missing (instead of skipping it)", async () => {
    mock_query.mockImplementation(accounts_query(new Set(["acct_1"])));
    await expect(
      format_transactions([txn(1, "acct_1"), txn(2, "acct_missing")], "item_1", "u1", undefined, "USD")
    ).rejects.toThrow(/acct_missing/);
  });
});
