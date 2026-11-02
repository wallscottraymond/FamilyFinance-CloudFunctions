/**
 * Purge job guard (Code-Health-Review S1-M6): which queued jobs are no-ops while their user is
 * being erased.
 */

import { purge_blocks_jobs, purge_guarded_user, PURGE_STALE_AFTER_MS } from "../purge_guard";

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

describe("purge_blocks_jobs (batch 10 verify L7)", () => {
  const NOW = 1_800_000_000_000;
  it("a live or finished purge blocks; blocked / failed / none don't", () => {
    expect(purge_blocks_jobs("running", NOW - 1000, NOW)).toBe(true);
    expect(purge_blocks_jobs("requested", NOW - 1000, NOW)).toBe(true);
    expect(purge_blocks_jobs("done", NOW - 10 * PURGE_STALE_AFTER_MS, NOW)).toBe(true);
    expect(purge_blocks_jobs("failed", NOW, NOW)).toBe(false);
    expect(purge_blocks_jobs("blocked", NOW, NOW)).toBe(false);
    expect(purge_blocks_jobs(undefined, NOW, NOW)).toBe(false);
  });
  it("a purge that died (no progress past the window) stops silencing the user's jobs", () => {
    expect(purge_blocks_jobs("running", NOW - PURGE_STALE_AFTER_MS - 1, NOW)).toBe(false);
    expect(purge_blocks_jobs("requested", NOW - PURGE_STALE_AFTER_MS - 1, NOW)).toBe(false);
    expect(purge_blocks_jobs("running", NOW - PURGE_STALE_AFTER_MS + 1, NOW)).toBe(true);
  });
  it("the window outlasts a job's timeout and the 15-minute stuck-job reclaim", () => {
    expect(PURGE_STALE_AFTER_MS).toBeGreaterThan(20 * 60 * 1000);
  });
});
