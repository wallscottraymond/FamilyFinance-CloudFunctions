/**
 * A sync / assignment batch stamps its run id on every write and runs ONE follow-up pass itself, so
 * `on_transaction_written` must not fan out per transaction for those writes — but a later user
 * edit (stamp unchanged) must still be processed.
 */
const mockCoalesce = jest.fn().mockResolvedValue(null);
const mockRecompute = jest.fn().mockResolvedValue(undefined);
const mockReconcile = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../infrastructure/job_queue", () => ({ coalesce_job: (...a: unknown[]) => mockCoalesce(...a) }));
jest.mock("../../../infrastructure/coalesced_jobs", () => ({
  enqueue_recompute_budget_spent: (...a: unknown[]) => mockRecompute(...a),
  enqueue_reconcile_recurring: (...a: unknown[]) => mockReconcile(...a),
}));

import { Timestamp } from "firebase-admin/firestore";
import {
  process_transaction_written_orchestrator,
  written_by_run,
} from "../process_transaction_written.orchestrator";

/* eslint-disable @typescript-eslint/naming-convention */
const ctx = { trace_id: "t", span_id: "s" };
const doc = (extra: Record<string, unknown>) => ({
  userId: "u",
  transactionDate: Timestamp.fromMillis(1_700_000_000_000),
  splitBudgetIds: ["b1"],
  splitOutflowIds: ["o1"],
  splits: [{ splitId: "sp", budgetId: "b1", outflowId: "o1", amount: 10 }],
  ...extra,
});

beforeEach(() => jest.clearAllMocks());

describe("written_by_run", () => {
  it("is true only when this write set a NEW run id", () => {
    expect(written_by_run(null, doc({ syncRunId: "r1" }), "syncRunId")).toBe(true);
    expect(written_by_run(doc({ syncRunId: "r0" }), doc({ syncRunId: "r1" }), "syncRunId")).toBe(true);
    expect(written_by_run(doc({ syncRunId: "r1" }), doc({ syncRunId: "r1" }), "syncRunId")).toBe(false);
    expect(written_by_run(null, doc({}), "syncRunId")).toBe(false);
  });
});

describe("process_transaction_written", () => {
  it("skips a sync-written create (no assign job, no recompute, no reconcile)", async () => {
    await process_transaction_written_orchestrator(ctx, {
      transaction_id: "x", user_id: "u", before: null, after: doc({ syncRunId: "run1" }), event_id: "e",
    });
    expect(mockCoalesce).not.toHaveBeenCalled();
    expect(mockRecompute).not.toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("skips an assignment-batch write", async () => {
    await process_transaction_written_orchestrator(ctx, {
      transaction_id: "x", user_id: "u",
      before: doc({ syncRunId: "run1" }),
      after: doc({ syncRunId: "run1", assignRunId: "a1", splitBudgetIds: ["b2"] }),
      event_id: "e",
    });
    expect(mockCoalesce).not.toHaveBeenCalled();
    expect(mockRecompute).not.toHaveBeenCalled();
  });

  it("still processes a later user edit on a synced transaction", async () => {
    await process_transaction_written_orchestrator(ctx, {
      transaction_id: "x", user_id: "u",
      before: doc({ syncRunId: "run1" }),
      after: doc({
        syncRunId: "run1",
        splits: [{ splitId: "sp", budgetId: "b1", outflowId: "o1", amount: 10, categorySource: "user", firstCategoryId: "shopping" }],
      }),
      event_id: "e",
    });
    expect(mockCoalesce).toHaveBeenCalledWith(
      "assign_user_transactions",
      expect.objectContaining({ deduplication_key: "assign_user:u" }),
      expect.anything()
    );
  });
});
