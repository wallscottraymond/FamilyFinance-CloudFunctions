/**
 * Code-Health-Review P4-M9: a note is in the cached transaction card and the app writes it
 * directly (no callable), so the trigger bumps the derive version once for that edit. Stamped bulk
 * writes never bump here (no per-document fan-out); other cosmetic edits don't either.
 */
const mockBump = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../repositories/derive_version.repo", () => ({ bump_derive_version: (...a: unknown[]) => mockBump(...a) }));
jest.mock("../../../infrastructure/job_queue", () => ({ coalesce_job: jest.fn().mockResolvedValue(null) }));
jest.mock("../../../infrastructure/coalesced_jobs", () => ({
  enqueue_recompute_budget_spent: jest.fn(), enqueue_reconcile_recurring: jest.fn(),
}));

import { Timestamp } from "firebase-admin/firestore";
import { process_transaction_written_orchestrator } from "../process_transaction_written.orchestrator";

/* eslint-disable @typescript-eslint/naming-convention */
const ctx = { trace_id: "t", span_id: "s" };
const doc = (extra: Record<string, unknown>) => ({
  userId: "u", transactionDate: Timestamp.fromMillis(1_700_000_000_000), splitBudgetIds: ["b1"],
  splits: [{ splitId: "sp", budgetId: "b1", amount: 10 }], userNotes: "", ...extra,
});
const run = (before: Record<string, unknown>, after: Record<string, unknown>) =>
  process_transaction_written_orchestrator(ctx, { transaction_id: "t1", user_id: "u", before, after } as never);

beforeEach(() => jest.clearAllMocks());

it("a user's note edit bumps once", async () => {
  await run(doc({}), doc({ userNotes: "dinner with Sam" }));
  expect(mockBump).toHaveBeenCalledTimes(1);
  expect(mockBump).toHaveBeenCalledWith("u");
});
it("a legacy notes edit bumps too", async () => {
  await run(doc({ notes: "a" }), doc({ notes: "b" }));
  expect(mockBump).toHaveBeenCalledTimes(1);
});
it("a stamped bulk write never bumps here (its writer bumps once)", async () => {
  await run(doc({}), doc({ userNotes: "carried", syncRunId: "run1" }));
  expect(mockBump).not.toHaveBeenCalled();
});
it("another cosmetic edit (no note change) doesn't bump", async () => {
  await run(doc({ description: "a" }), doc({ description: "b" }));
  expect(mockBump).not.toHaveBeenCalled();
});
