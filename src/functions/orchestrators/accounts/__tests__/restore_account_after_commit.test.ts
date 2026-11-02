/**
 * restore_account after its transaction commits (batch 10 verify #2 L3): a failure afterwards
 * must not lose what's left. A retry finds the account active, so that path does the remaining
 * work; the re-assign after coming back private runs before anything that can throw.
 */

const mock_get_by_id = jest.fn();
const mock_restore = jest.fn();
const mock_item_get = jest.fn();
const mock_item_update = jest.fn();
const mock_create_job = jest.fn();
const mock_complete_key = jest.fn();
const mock_fail_key = jest.fn();
const mock_reassign = jest.fn();
const mock_refresh = jest.fn();

jest.mock("../../../repositories", () => ({
  account_repo: {
    get_by_id: (...a: unknown[]) => mock_get_by_id(...a),
    restore: (...a: unknown[]) => mock_restore(...a),
  },
}));
jest.mock("../../../repositories/plaid/plaid_item.repo", () => ({
  plaid_item_repo: {
    get_by_id: (...a: unknown[]) => mock_item_get(...a),
    apply_field_update: (...a: unknown[]) => mock_item_update(...a),
  },
}));
jest.mock("../../../repositories/sharing", () => ({ group_repo: { get: async () => null } }));
jest.mock("../../../repositories/derive_version.repo", () => ({ bump_derive_version: async () => undefined }));
jest.mock("../../../infrastructure/job_queue", () => ({
  create_job: (...a: unknown[]) => mock_create_job(...a),
}));
jest.mock("../../../infrastructure/idempotency_store", () => ({
  check_idempotency: async () => ({ is_duplicate: false }),
  claim_key: async () => true,
  complete_key: (...a: unknown[]) => mock_complete_key(...a),
  fail_key: (...a: unknown[]) => mock_fail_key(...a),
}));
jest.mock("../../sharing/view_reassign", () => ({
  reassign_accounts: (...a: unknown[]) => mock_reassign(...a),
  refresh_group_transfer_roles: (...a: unknown[]) => mock_refresh(...a),
}));
jest.mock("../../../resolvers/sharing/sharing.resolver", () => ({ to_placeable: (a: unknown) => a }));

import { restore_account_orchestrator } from "../restore_account.orchestrator";

const REASON = "Restored as private: someone in that group already shares this account.";
const input = {
  account_id: "a1", idempotency_key: "k", restore_transactions: true, restore_recurring: true,
};
const t = { trace_id: "t", span_id: "s" };
const account = (is_active: boolean) => ({
  id: "a1", account_id: "plaid_a1", user_id: "u1", item_id: "item1", is_active, is_deleted: !is_active,
  placement: null, access: { owner_id: "u1", created_by: "u1", group_ids: [], is_private: true },
});
const jobs = () => mock_create_job.mock.calls.map((c) => c[0]);

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  for (const m of [
    mock_get_by_id, mock_restore, mock_item_get, mock_item_update, mock_create_job,
    mock_complete_key, mock_fail_key, mock_reassign, mock_refresh,
  ]) m.mockReset();
  mock_item_get.mockResolvedValue({ is_active: true });
  mock_get_by_id.mockResolvedValue(account(false));
  mock_restore.mockResolvedValue({ write: {}, private_reason: REASON });
});

it("the re-assign runs before anything that can throw", async () => {
  mock_item_update.mockRejectedValue(new Error("down"));
  await expect(restore_account_orchestrator(t, "u1", input)).rejects.toThrow("down");
  expect(mock_reassign).toHaveBeenCalledTimes(1);
  expect(mock_refresh).toHaveBeenCalledTimes(1);
});

it("a failed key completion doesn't lose the reason or the jobs", async () => {
  mock_complete_key.mockRejectedValue(new Error("key down"));
  const r = await restore_account_orchestrator(t, "u1", input);
  expect(r).toMatchObject({ success: true, made_private_reason: REASON, restore_jobs_enqueued: true });
  expect(jobs()).toEqual(["restore_account_transactions", "restore_account_recurring"]);
  expect(mock_fail_key).not.toHaveBeenCalled();
});

it("the retry after a post-commit throw does the remaining work", async () => {
  mock_get_by_id.mockResolvedValue(account(true)); // the first attempt's restore committed
  const r = await restore_account_orchestrator(t, "u1", input);
  expect(r).toMatchObject({ success: true, was_idempotent: true, restore_jobs_enqueued: true });
  expect(jobs()).toEqual(["restore_account_transactions", "restore_account_recurring"]);
  expect(mock_item_update).toHaveBeenCalledWith(expect.anything(), "item1", { removalPending: false });
  expect(mock_restore).not.toHaveBeenCalled();
});

it("that path queues only what was asked for, and clears nothing on a dead bank link", async () => {
  mock_get_by_id.mockResolvedValue(account(true));
  mock_item_get.mockResolvedValue({ is_active: false });
  const r = await restore_account_orchestrator(t, "u1", {
    ...input, restore_transactions: false, restore_recurring: false,
  });
  expect(r.restore_jobs_enqueued).toBe(false);
  expect(jobs()).toEqual([]);
  expect(mock_item_update).not.toHaveBeenCalled();
});
