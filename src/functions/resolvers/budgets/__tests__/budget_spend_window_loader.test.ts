/**
 * create_window_txn_loader — each distinct window is read ONCE per recompute job, and
 * resolve_spend_splits returns identical results with or without the loader.
 */

const get_active_in_date_range = jest.fn(async (_c: unknown, _u: string, s: number, e: number) => [
  {
    id: `t${s}`,
    data: {
      transactionDate: { toMillis: () => s },
      splits: [{ amount: 10, monthlyBudgetId: "b1" }, { amount: 5, monthlyBudgetId: "b2" }],
      type: "expense",
      endMs: e,
    },
  },
]);

jest.mock("../../../repositories/transaction.repo", () => ({
  transaction_repo: { get_active_in_date_range },
}));

import { create_window_txn_loader, resolve_spend_splits } from "../budget_spend.resolver";

const ctx = { trace_id: "t" } as never;

beforeEach(() => get_active_in_date_range.mockClear());

it("reads each distinct window once", async () => {
  const load = create_window_txn_loader(ctx, "u1");
  await Promise.all([load(1, 2), load(1, 2), load(3, 4), load(1, 2)]);
  expect(get_active_in_date_range).toHaveBeenCalledTimes(2);
});

it("resolve_spend_splits gives the same splits with the shared loader", async () => {
  const direct_b1 = await resolve_spend_splits(ctx, "u1", "b1", 1, 2, "monthly");
  const direct_b2 = await resolve_spend_splits(ctx, "u1", "b2", 1, 2, "monthly");
  get_active_in_date_range.mockClear();
  const load = create_window_txn_loader(ctx, "u1");
  const via_b1 = await resolve_spend_splits(ctx, "u1", "b1", 1, 2, "monthly", load);
  const via_b2 = await resolve_spend_splits(ctx, "u1", "b2", 1, 2, "monthly", load);
  expect(via_b1).toEqual(direct_b1);
  expect(via_b2).toEqual(direct_b2);
  expect(get_active_in_date_range).toHaveBeenCalledTimes(1); // two budgets, one read
});
