/**
 * Code-Health-Review M3-M6: a stream whose reconcile failed was logged, then the watermark moved
 * past it — it was never reconciled again until it changed. Now the failed stream gets its own
 * queued (retried) reconcile job; the others and the watermark proceed as before.
 */
import { Timestamp } from "firebase-admin/firestore";

const coalesce_job = jest.fn(async () => null);
const reconcile = jest.fn();
const set_watermark = jest.fn(async () => undefined);
jest.mock("../../../infrastructure/job_queue", () => ({ coalesce_job: (...a: unknown[]) => coalesce_job(...(a as [])) }));
jest.mock("../reconcile_recurring_periods.orchestrator", () => ({
  reconcile_recurring_periods_orchestrator: (...a: unknown[]) => reconcile(...a),
}));
jest.mock("../../transactions/assign_transactions_batch.orchestrator", () => ({
  assign_transactions_batch_orchestrator: jest.fn(async () => undefined),
}));
jest.mock("../../plaid/sync_follow_ups", () => ({
  follow_ups_from_written: jest.fn(), run_sync_follow_ups: jest.fn(),
}));
jest.mock("../../../repositories/recurring_reconcile_watermark.repo", () => ({
  get_recurring_reconcile_watermark_ms: jest.fn(async () => 0),
  set_recurring_reconcile_watermark_ms: (...a: unknown[]) => set_watermark(...(a as [])),
}));
const T = (ms: number) => Timestamp.fromMillis(ms);
jest.mock("../../../repositories/outflow.repo", () => ({
  outflow_repo: { get_by_user_id: jest.fn(async () => [
    { id: "ok_bill", updated_at: T(1000), transaction_ids: ["p1"] },
    { id: "bad_bill", updated_at: T(2000), transaction_ids: ["p2"] },
  ]) },
}));
jest.mock("../../../repositories/inflow.repo", () => ({ inflow_repo: { get_by_user_id: jest.fn(async () => []) } }));
jest.mock("../../../repositories/transaction.repo", () => ({
  transaction_repo: { get_by_plaid_transaction_ids: jest.fn(async () => []) },
}));

import { reconcile_user_recurring_orchestrator } from "../reconcile_user_recurring.orchestrator";

it("a failed stream is queued for its own retried reconcile; the rest + watermark proceed", async () => {
  reconcile.mockImplementation(async (_ctx: unknown, input: { recurring_id: string }) => {
    if (input.recurring_id === "bad_bill") throw new Error("boom");
  });
  const out = await reconcile_user_recurring_orchestrator({ trace_id: "t", span_id: "s" }, { user_id: "u" } as never);
  expect(out).toMatchObject({ reconciled: 1 });
  expect(coalesce_job).toHaveBeenCalledTimes(1);
  expect(coalesce_job).toHaveBeenCalledWith(
    "reconcile_recurring_period",
    expect.objectContaining({ recurring_id: "bad_bill", recurring_type: "outflow", user_id: "u" }),
    expect.objectContaining({ delay_seconds: 30 })
  );
  expect(set_watermark).toHaveBeenCalledWith("u", 2000);
});
