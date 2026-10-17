/**
 * X18: the flag check never throws into a caller — a flag doc missing fields, malformed fields or a
 * failed read all read as OFF. Firestore is mocked (unit project: no emulator).
 */
let docs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
let fail = false;
let gets = 0;
let release: (() => void) | null = null;
jest.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: () => ({
      get: async () => {
        gets++;
        if (release === null) {
          // no gate
        } else {
          await new Promise<void>((r) => { release = r; });
        }
        if (fail) throw new Error("unavailable");
        return { docs };
      },
    }),
  }),
  Timestamp: { now: () => ({}) },
}));

import {
  invalidate_flag_cache,
  is_convert_to_recurring_enabled,
  is_flag_enabled,
} from "../feature_flags";

const flag = (data: Record<string, unknown>) => {
  docs = [{ id: "convert_to_recurring_v1", data: () => data }];
  invalidate_flag_cache();
};

describe("feature flags — hardened (X18)", () => {
  beforeEach(() => {
    fail = false;
    docs = [];
    invalidate_flag_cache();
  });

  it("missing doc → off", async () => {
    expect(await is_convert_to_recurring_enabled("u1")).toBe(false);
  });

  it("doc missing enabled_user_ids / enabled_group_ids / rollout → no crash, off unless allowlisted", async () => {
    flag({ enabled: true });
    await expect(is_convert_to_recurring_enabled("u1")).resolves.toBe(false);
    await expect(is_flag_enabled("convert_to_recurring_v1", { user_id: "u1", group_ids: ["g1"] })).resolves.toBe(false);
  });

  it("malformed fields → off, no throw", async () => {
    flag({ enabled: "yes", enabled_user_ids: "u1" });
    expect(await is_convert_to_recurring_enabled("u1")).toBe(false);
    flag({ enabled: true, enabled_user_ids: "u1", enabled_group_ids: 5, rollout_percentage: "100" });
    expect(await is_convert_to_recurring_enabled("u1")).toBe(false);
  });

  it("allowlisted user → on; others off; complete doc", async () => {
    flag({ enabled: true, enabled_user_ids: ["u1"], enabled_group_ids: [], rollout_percentage: 0 });
    expect(await is_convert_to_recurring_enabled("u1")).toBe(true);
    expect(await is_convert_to_recurring_enabled("u2")).toBe(false);
    expect(await is_convert_to_recurring_enabled("")).toBe(false);
  });

  it("globally disabled wins over the allowlist (kill switch)", async () => {
    flag({ enabled: false, enabled_user_ids: ["u1"], enabled_group_ids: [], rollout_percentage: 100 });
    expect(await is_convert_to_recurring_enabled("u1")).toBe(false);
  });

  it("a failed flag read → off, no throw", async () => {
    fail = true;
    await expect(is_convert_to_recurring_enabled("u1")).resolves.toBe(false);
  });

  it("single-flight: concurrent cold callers share ONE read (round 4 defect 3)", async () => {
    flag({ enabled: true, enabled_user_ids: ["u2"], enabled_group_ids: [], rollout_percentage: 0 });
    gets = 0;
    release = () => undefined; // gate the read so all three callers arrive while it is in flight
    const all = Promise.all(["u1", "u2", "u3"].map((u) => is_convert_to_recurring_enabled(u)));
    await new Promise((r) => setImmediate(r));
    (release as unknown as () => void)();
    release = null;
    expect(await all).toEqual([false, true, false]);
    expect(gets).toBe(1);
    // Warm: no read. Invalidated: exactly one more.
    await is_convert_to_recurring_enabled("u1");
    expect(gets).toBe(1);
    invalidate_flag_cache();
    await Promise.all([is_convert_to_recurring_enabled("u1"), is_convert_to_recurring_enabled("u2")]);
    expect(gets).toBe(2);
  });

  it("single-flight: a failed shared read → every waiter off, and the next call retries", async () => {
    fail = true;
    gets = 0;
    const r = await Promise.all([is_convert_to_recurring_enabled("u1"), is_convert_to_recurring_enabled("u2")]);
    expect(r).toEqual([false, false]);
    expect(gets).toBe(1);
    fail = false;
    flag({ enabled: true, enabled_user_ids: ["u1"] });
    expect(await is_convert_to_recurring_enabled("u1")).toBe(true);
    expect(gets).toBe(2);
  });

  it("an invalidation during an in-flight read is not overwritten by that read", async () => {
    flag({ enabled: true, enabled_user_ids: ["u1"] });
    release = () => undefined;
    const p = is_convert_to_recurring_enabled("u1");
    await new Promise((r) => setImmediate(r));
    docs = []; // the flag was deleted meanwhile
    invalidate_flag_cache();
    (release as unknown as () => void)();
    release = null;
    await p;
    expect(await is_convert_to_recurring_enabled("u1")).toBe(false); // re-read, not the stale snapshot
  });
});
