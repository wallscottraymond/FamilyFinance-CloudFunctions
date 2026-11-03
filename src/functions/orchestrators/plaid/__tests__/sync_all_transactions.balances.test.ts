/** AF-15: the cron refreshes balances once a day; transactions keep their 6-hourly sync. */
const mockBalance = jest.fn(async () => ({ accounts_updated: 2 }));
const mockQueue = jest.fn(async () => undefined);
jest.mock("../sync_balances.orchestrator", () => ({ sync_balances_orchestrator: mockBalance }));
jest.mock("../sync_item.orchestrator", () => ({ enqueue_item_sync: mockQueue }));
jest.mock("../../../repositories/plaid/plaid_item.repo", () => ({
  plaid_item_repo: {
    get_all_active: jest.fn(async () => [
      { item_doc_id: "a", plaid_item_id: "pa", user_id: "u", status: "good" },
      { item_doc_id: "b", plaid_item_id: "pb", user_id: "u", status: "good" },
    ]),
  },
}));

import { sync_all_transactions_orchestrator as run } from "../sync_all_transactions.orchestrator";

const ctx = { trace_id: "t", span_id: "s" } as never;
const at = (h: number) => Date.UTC(2026, 10, 3, h, 0, 5);

describe("balance calls per day", () => {
  beforeEach(() => jest.clearAllMocks());
  it("all four runs a day: 1 balance call per connection, 4 transaction syncs", async () => {
    for (const h of [0, 6, 12, 18]) await run(ctx, at(h));
    expect(mockBalance).toHaveBeenCalledTimes(2);
    expect(mockQueue).toHaveBeenCalledTimes(8);
  });
  it("the morning run refreshes balances", async () => {
    const r = await run(ctx, at(12));
    expect(r.balances_updated_total).toBe(4);
  });
  it("a run a few minutes late still counts", async () => {
    await run(ctx, Date.UTC(2026, 10, 3, 12, 40));
    expect(mockBalance).toHaveBeenCalledTimes(2);
  });
});
