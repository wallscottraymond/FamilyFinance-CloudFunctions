import {
  compute_recent_transactions,
  is_recent_transfer,
  recent_bill_ids,
  select_recent_transactions,
  WidgetRawTxn,
} from "../widget_snapshot.service";

const ts = (ms: number) => ({ toMillis: () => ms });
const DAY = 86_400_000;

const txn = (id: string, day: number, data: Record<string, unknown> = {}): WidgetRawTxn => ({
  id,
  data: {
    userId: "u1",
    accountId: "a1",
    transactionDate: ts(day * DAY),
    merchantName: `M ${id}`,
    splits: [{ amount: 10, budgetName: "Groceries", isDefault: true }],
    ...data,
  },
});

describe("Recent transactions widget: which rows show (mirrors the Home card, transfers hidden)", () => {
  it("newest first, capped, without soft-deleted, split-less, owner-less rows or duplicates", () => {
    const rows = [
      txn("old", 1),
      txn("new", 5),
      txn("mid", 3),
      txn("gone", 6, { isActive: false }),
      txn("deleted", 6, { isDeleted: true }),
      txn("nosplits", 6, { splits: [] }),
      txn("noowner", 6, { userId: undefined }),
      txn("mid", 3),
    ];
    expect(select_recent_transactions(rows).map((r) => r.id)).toEqual(["new", "mid", "old"]);
    expect(select_recent_transactions(rows, 2).map((r) => r.id)).toEqual(["new", "mid"]);
  });

  it("transfers: the stored role decides; without one, every split must be a transfer category", () => {
    expect(is_recent_transfer({ transferRole: "internal" })).toBe(true);
    expect(is_recent_transfer({ transferRole: "external" })).toBe(true);
    expect(is_recent_transfer({ transferRole: "edge_out" })).toBe(false);
    // "none" = the user re-categorized it: not a transfer, even with a transfer category.
    expect(is_recent_transfer({ transferRole: "none", splits: [{ plaidDetailedCategory: "TRANSFER_OUT_X" }] })).toBe(false);
    expect(is_recent_transfer({ splits: [{ plaidDetailedCategory: "TRANSFER_IN_DEPOSIT" }] })).toBe(true);
    expect(
      is_recent_transfer({ splits: [{ plaidDetailedCategory: "TRANSFER_IN_DEPOSIT" }, { plaidDetailedCategory: "FOOD_AND_DRINK" }] })
    ).toBe(false);
    expect(is_recent_transfer({ splits: [] })).toBe(false);
    const shown = select_recent_transactions([txn("t", 2, { transferRole: "internal" }), txn("k", 1)]);
    expect(shown.map((r) => r.id)).toEqual(["k"]);
  });

  it("bill ids: only non-ignored splits linked to a bill", () => {
    const rows = [
      txn("b", 1, { splits: [{ amount: 80, outflowId: "o1" }, { amount: 5, outflowId: "o2", isIgnored: true }] }),
      txn("c", 2),
    ];
    expect(recent_bill_ids(rows)).toEqual(["o1"]);
  });
});

describe("Recent transactions widget: each row", () => {
  it("name, date, amount and direction like the app's TransactionCard", () => {
    const [row] = compute_recent_transactions(
      [txn("x", 4, { merchantName: "", metadata: { plaidMerchantName: "Trader Joe's" }, isPending: true })],
      new Map()
    );
    expect(row).toMatchObject({ id: "x", accountId: "a1", name: "Trader Joe's", dateMs: 4 * DAY, amount: 10, income: false, pending: true });
    const [paycheck] = compute_recent_transactions(
      [txn("p", 1, { type: "income", splits: [{ amount: 2140 }] })],
      new Map()
    );
    expect(paycheck).toMatchObject({ income: true, amount: 2140, budget: "Income", bill: null });
    const [refund] = compute_recent_transactions([txn("r", 1, { splits: [{ amount: -19.99, budgetName: "Everything else" }] })], new Map());
    expect(refund).toMatchObject({ income: true, amount: 19.99, budget: "Everything else" });
  });

  it("bill: the bill's own name (custom > merchant > description > the split's), else 'Bill'", () => {
    const bills = new Map<string, Record<string, unknown>>([["o1", { userCustomName: "Internet", merchantName: "Xfinity" }]]);
    const [named] = compute_recent_transactions([txn("b", 1, { splits: [{ amount: 80, outflowId: "o1" }] })], bills);
    expect(named.bill).toBe("Internet");
    const [fallback] = compute_recent_transactions(
      [txn("b", 1, { splits: [{ amount: 80, outflowId: "missing", outflowDescription: "Netflix" }] })],
      bills
    );
    expect(fallback.bill).toBe("Netflix");
    const [plain] = compute_recent_transactions([txn("b", 1, { splits: [{ amount: 80, outflowId: "missing" }] })], bills);
    expect(plain.bill).toBe("Bill");
  });

  it("budget: the primary split's, plus how many other budgets ('Groceries +1')", () => {
    const [split] = compute_recent_transactions(
      [
        txn("s", 1, {
          splits: [
            { amount: 30, budgetName: "Household" },
            { amount: 40, budgetName: "Groceries", isDefault: true },
            { amount: 5, budgetName: "Groceries" },
          ],
        }),
      ],
      new Map()
    );
    expect(split).toMatchObject({ budget: "Groceries", moreBudgets: 1, amount: 75 });
  });
});
