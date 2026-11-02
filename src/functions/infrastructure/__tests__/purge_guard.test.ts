/**
 * Purge job guard (Code-Health-Review S1-M6): which queued jobs are no-ops while their user is
 * being erased.
 */

import { purge_guarded_user } from "../purge_guard";

describe("purge_guarded_user (S1-M6)", () => {
  it("every user job is guarded by its payload.user_id", () => {
    const types = ["reassign_user", "classify_transfers", "recompute_budget_spent", "sync_item"];
    for (const type of types) {
      expect(purge_guarded_user(type, { user_id: "u1" })).toBe("u1");
    }
  });
  it("the purge itself, group-view jobs and system jobs are never guarded", () => {
    expect(purge_guarded_user("purge_user_data", { user_id: "u1" })).toBeNull();
    expect(purge_guarded_user("recompute_budget_spent", { user_id: "group:g1" })).toBeNull();
    expect(purge_guarded_user("category_reassign_fanout", {})).toBeNull();
    expect(purge_guarded_user("backfill_assignments", { mode: "fan_out_users" })).toBeNull();
    expect(purge_guarded_user("x", null)).toBeNull();
    expect(purge_guarded_user("x", { user_id: "" })).toBeNull();
  });
});
