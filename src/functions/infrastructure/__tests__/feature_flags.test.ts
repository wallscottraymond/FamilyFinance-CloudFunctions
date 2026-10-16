/**
 * X18: the flag check never throws into a caller — a flag doc missing fields, malformed fields or a
 * failed read all read as OFF. Firestore is mocked (unit project: no emulator).
 */
let docs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
let fail = false;
jest.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: () => ({
      get: async () => {
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
});
