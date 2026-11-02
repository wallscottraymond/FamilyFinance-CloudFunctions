/**
 * update_budget auto-resume (batch 10 verify L4, L5): the pause write is compare-and-set (a pause
 * or resume racing the edit is kept, not overwritten); the follow-ups after the save can't fail
 * the request (a retry would find the categories already saved and skip claims / re-home).
 */

const mock_save_changes = jest.fn();
const mock_replace = jest.fn();
const mock_get_by_id = jest.fn();
const mock_bump = jest.fn();
const mock_create_job = jest.fn();
const mock_fail_key = jest.fn();
const mock_resolve = jest.fn();

jest.mock("../../../repositories/budget.repo", () => ({
  budget_repo: {
    save_changes: (...a: unknown[]) => mock_save_changes(...a),
    replace_paused_ranges_if_unchanged: (...a: unknown[]) => mock_replace(...a),
    get_by_id: (...a: unknown[]) => mock_get_by_id(...a),
  },
}));
jest.mock("../../../repositories/derive_version.repo", () => ({
  bump_derive_version: (...a: unknown[]) => mock_bump(...a),
}));
jest.mock("../../../infrastructure/job_queue", () => ({
  create_job: (...a: unknown[]) => mock_create_job(...a),
}));
jest.mock("../../../infrastructure/idempotency_store", () => ({
  check_idempotency: async () => ({ is_duplicate: false }),
  claim_key: async () => true,
  complete_key: async () => undefined,
  fail_key: (...a: unknown[]) => mock_fail_key(...a),
}));
jest.mock("../../../resolvers/budgets/update_budget.resolver", () => ({
  resolve_update_budget_dependencies: (...a: unknown[]) => mock_resolve(...a),
}));

import { Timestamp } from "firebase-admin/firestore";
import { update_budget_orchestrator } from "../update_budget.orchestrator";
import { utc_day } from "../../../domain/budgets/budget_pause.service";

const t = { trace_id: "t", span_id: "s" };
const TODAY = utc_day(Date.now());
const FAR = TODAY + 10_000;

function deps(paused = [{ start_day: TODAY - 5, end_day: FAR }]) {
  return {
    existing: {
      id: "b1", user_id: "u1", name: "Fast Food", amount: 400, spent: 0, remaining: 400,
      category_ids: [], period: "monthly", is_ongoing: true, group_ids: [],
      start_date: Timestamp.fromMillis(Date.UTC(2026, 0, 1)), paused_ranges: paused,
    },
    added_category_ids: ["groceries"], removed_category_ids: [],
    everything_else_budget_id: "ee", amount_changed: false, view_budgets: [], first_by_category: {},
  };
}
const edit = () =>
  update_budget_orchestrator(t, "u1", `k_${Math.random()}`, { budget_id: "b1", category_ids: ["groceries"] });
const jobs = () => mock_create_job.mock.calls.map((c) => c[0]);

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  for (const m of [mock_save_changes, mock_replace, mock_get_by_id, mock_bump, mock_create_job, mock_fail_key]) {
    m.mockReset();
  }
  mock_replace.mockResolvedValue(true);
  mock_resolve.mockResolvedValue(deps());
});

describe("L5: the pause write is compare-and-set", () => {
  it("clears today onward through the CAS; the save never carries pausedRanges", async () => {
    await edit();
    expect(mock_replace).toHaveBeenCalledTimes(1);
    const [, id, expected, next] = mock_replace.mock.calls[0];
    expect(id).toBe("b1");
    expect(expected).toEqual([{ start_day: TODAY - 5, end_day: FAR }]);
    expect(next).toEqual([{ start_day: TODAY - 5, end_day: TODAY - 1 }]);
    const [, before, after] = mock_save_changes.mock.calls[0];
    expect(after.paused_ranges).toEqual(before.paused_ranges); // no diff → field untouched
    expect(after.category_ids).toEqual(["groceries"]);
  });

  it("a concurrent change is re-read and re-applied, never overwritten", async () => {
    mock_replace.mockResolvedValueOnce(false);
    // Someone resumed a stretch meanwhile: the ranges we expected are gone.
    const fresh = [{ start_day: TODAY - 5, end_day: TODAY + 2 }, { start_day: TODAY + 40, end_day: FAR }];
    mock_get_by_id.mockResolvedValue({ paused_ranges: fresh });
    await edit();
    expect(mock_replace).toHaveBeenCalledTimes(2);
    const [, , expected, next] = mock_replace.mock.calls[1];
    expect(expected).toEqual(fresh);
    expect(next).toEqual([{ start_day: TODAY - 5, end_day: TODAY - 1 }]);
  });

  it("the pause is written BEFORE the save: a retry after a crash still sees empty → non-empty", async () => {
    const order: string[] = [];
    mock_replace.mockImplementation(async () => { order.push("pause"); return true; });
    mock_save_changes.mockImplementation(async () => { order.push("save"); });
    await edit();
    expect(order).toEqual(["pause", "save"]);
  });

  it("a budget with categories never touches the CAS", async () => {
    const d = deps();
    mock_resolve.mockResolvedValue({
      ...d, existing: { ...d.existing, category_ids: ["a"] }, added_category_ids: [],
    });
    await update_budget_orchestrator(t, "u1", "k_amount", { budget_id: "b1", amount: 500 });
    expect(mock_replace).not.toHaveBeenCalled();
    expect(mock_bump).not.toHaveBeenCalled();
  });
});

describe("L4: follow-ups after the save are non-fatal", () => {
  it("a failed bump doesn't stop the cascade or fail the request", async () => {
    mock_bump.mockRejectedValue(new Error("bump down"));
    await expect(edit()).resolves.toMatchObject({ budget_id: "b1", categories_claimed: 1 });
    expect(jobs()).toContain("process_budget_updated");
    expect(jobs()).toContain("recompute_budget_spent");
    expect(mock_fail_key).not.toHaveBeenCalled();
  });

  it("a failed recompute enqueue doesn't stop the cascade or fail the request", async () => {
    mock_create_job.mockImplementation(async (type: string) => {
      if (type === "recompute_budget_spent") throw new Error("queue down");
    });
    await expect(edit()).resolves.toMatchObject({ budget_id: "b1" });
    expect(jobs()).toContain("process_budget_updated");
    expect(mock_fail_key).not.toHaveBeenCalled();
  });
});
