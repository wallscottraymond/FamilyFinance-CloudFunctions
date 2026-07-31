/**
 * Emulator Integration Tests — Purge User Data (full erase)
 *
 * Runs `purge_user_data_orchestrator` directly against the Firestore emulator,
 * seeded by `seedAccountGraph` plus a few extra user-keyed docs. Asserts:
 *   - EVERY user-keyed collection is emptied (hard delete)
 *   - a SECOND user's graph is untouched (isolation)
 *   - the `purge_status/{uid}` doc ends `done`
 *   - a user owning a group with other members is BLOCKED (no data deleted)
 *   - a transient Plaid `/item/remove` failure KEEPS that item's token + throws
 *     (job retries) rather than orphaning a still-billed connection
 *
 * Plaid `remove_item` + token decryption are mocked (no real Plaid/creds under
 * the bare Firestore emulator); Firebase-Auth `deleteUser` is best-effort in the
 * orchestrator (try/catch) so it fails harmlessly here.
 *
 * Prereq: firebase emulators:exec --only firestore "npm run test:emulator"
 */

/* eslint-disable @typescript-eslint/naming-convention */

// Mock the Plaid revoke + token decrypt BEFORE importing the orchestrator.
jest.mock('../src/functions/integrations/plaid', () => ({
  remove_item: jest.fn(),
}));
jest.mock('../src/utils/encryption', () => ({
  ...jest.requireActual('../src/utils/encryption'),
  decryptAccessToken: (t: string) => t, // passthrough — no real key needed
}));

import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "family-budget-app-cb59b" });
}
const db = admin.firestore();

import { Timestamp } from "firebase-admin/firestore";
import { remove_item } from "../src/functions/integrations/plaid";
import { purge_user_data_orchestrator } from "../src/functions/orchestrators/users/purge_user_data.orchestrator";
import { cancel_pending_jobs } from "../src/functions/repositories/purge.repo";
import { seedAccountGraph } from "./helpers/seedAccountGraph";

const mockRemoveItem = remove_item as jest.Mock;

const ctx = () => ({
  trace_id: `t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
  span_id: `s_${Date.now()}`,
});

async function countWhere(
  collection: string,
  field: string,
  value: string
): Promise<number> {
  const snap = await db.collection(collection).where(field, "==", value).get();
  return snap.size;
}

async function seedExtras(userId: string, itemDocId: string): Promise<void> {
  const now = Timestamp.now();
  const budgetId = `budget_${userId}`;
  const batch = db.batch();
  batch.set(db.collection("budgets").doc(budgetId), {
    id: budgetId, ownerId: userId, userId, name: "Test Budget",
    isActive: true, createdAt: now, updatedAt: now,
  });
  batch.set(db.collection("budget_periods").doc(`${budgetId}_2026M01`), {
    id: `${budgetId}_2026M01`, budgetId, userId, spent: 0, createdAt: now,
  });
  batch.set(db.collection("user_summaries").doc(`${userId}_2026M01`), {
    id: `${userId}_2026M01`, userId, createdAt: now,
  });
  batch.set(db.collection("users").doc(userId), {
    id: userId, email: `${userId}@test.local`, createdAt: now,
  });
  batch.set(db.collection("plaid_webhooks").doc(`wh_${userId}`), {
    id: `wh_${userId}`, plaidItemId: itemDocId, webhookType: "TRANSACTIONS", createdAt: now,
  });
  await batch.commit();
}

describe("purge_user_data_orchestrator — full erase", () => {
  beforeEach(() => {
    mockRemoveItem.mockReset();
    // Default: revoke succeeds.
    mockRemoveItem.mockResolvedValue({ success: true, already_removed: false, request_id: "x" });
  });

  it("hard-deletes every user-keyed collection + revokes Plaid + marks status done", async () => {
    const seed = await seedAccountGraph(db, {
      accounts: 2, txnsPerAccount: 3, outflows: 2, inflows: 1, periodsPerRecurring: 2,
    });
    await seedExtras(seed.userId, seed.itemDocId);

    expect(await countWhere("transactions", "userId", seed.userId)).toBe(6);
    expect(await countWhere("budgets", "ownerId", seed.userId)).toBe(1);

    const result = await purge_user_data_orchestrator(ctx(), {
      user_id: seed.userId, initiated_by: seed.userId, trace_id: "t_purge",
    });

    expect(result.blocked).toBe(false);
    expect(result.success).toBe(true);
    expect(mockRemoveItem).toHaveBeenCalledTimes(1); // the one seeded plaid_item

    expect(await countWhere("transactions", "userId", seed.userId)).toBe(0);
    expect(await countWhere("accounts", "userId", seed.userId)).toBe(0);
    expect(await countWhere("plaid_items", "userId", seed.userId)).toBe(0);
    expect(await countWhere("outflows", "ownerId", seed.userId)).toBe(0);
    expect(await countWhere("inflows", "ownerId", seed.userId)).toBe(0);
    expect(await countWhere("outflow_periods", "outflowId", seed.outflowIds[0])).toBe(0);
    expect(await countWhere("inflow_periods", "inflowId", seed.inflowIds[0])).toBe(0);
    expect(await countWhere("budgets", "ownerId", seed.userId)).toBe(0);
    expect(await countWhere("budget_periods", "userId", seed.userId)).toBe(0);
    expect(await countWhere("user_summaries", "userId", seed.userId)).toBe(0);
    expect(await countWhere("plaid_webhooks", "plaidItemId", seed.itemDocId)).toBe(0);
    expect((await db.collection("users").doc(seed.userId).get()).exists).toBe(false);

    const status = (await db.collection("purge_status").doc(seed.userId).get()).data();
    expect(status?.state).toBe("done");
  });

  it("does NOT touch a second user's data (isolation)", async () => {
    const victim = await seedAccountGraph(db, { accounts: 1, txnsPerAccount: 2 });
    const bystander = await seedAccountGraph(db, { accounts: 1, txnsPerAccount: 4 });

    await purge_user_data_orchestrator(ctx(), {
      user_id: victim.userId, initiated_by: victim.userId, trace_id: "t_iso",
    });

    expect(await countWhere("transactions", "userId", victim.userId)).toBe(0);
    expect(await countWhere("transactions", "userId", bystander.userId)).toBe(4);
    expect(await countWhere("accounts", "userId", bystander.userId)).toBe(1);
  });

  it("BLOCKS when the user owns a group with other members (no data deleted)", async () => {
    const seed = await seedAccountGraph(db, { accounts: 1, txnsPerAccount: 2 });
    const now = Timestamp.now();
    await db.collection("groups").doc(`grp_${seed.userId}`).set({
      id: `grp_${seed.userId}`, name: "Shared Group", ownerId: seed.userId, isActive: true,
      members: [
        { userId: seed.userId, role: "owner" },
        { userId: "other_member", role: "viewer" },
      ],
      createdAt: now,
    });

    const result = await purge_user_data_orchestrator(ctx(), {
      user_id: seed.userId, initiated_by: seed.userId, trace_id: "t_block",
    });

    expect(result.blocked).toBe(true);
    expect(await countWhere("transactions", "userId", seed.userId)).toBe(2);
    const status = (await db.collection("purge_status").doc(seed.userId).get()).data();
    expect(status?.state).toBe("blocked");
    expect(status?.blocked_reason).toBe("owns_group_with_members");
  });

  it("cancel_pending_jobs targets ONLY this user's pending/processing non-purge jobs", async () => {
    const uid = `canceltest_${Date.now()}`;
    const other = `other_${Date.now()}`;
    const now = Timestamp.now();
    const mk = (id: string, user: string, status: string, job_type = "recompute_budget_spent") =>
      db.collection("_jobs").doc(id).set({
        job_id: id, job_type, status, payload: { user_id: user },
        retry_count: 0, max_retries: 3, created_at: now, updated_at: now,
      });
    await Promise.all([
      mk(`${uid}_p1`, uid, "pending"),
      mk(`${uid}_p2`, uid, "pending"),
      mk(`${uid}_proc`, uid, "processing"),
      mk(`${uid}_done`, uid, "completed"),            // terminal → skip
      mk(`${uid}_purge`, uid, "processing", "purge_user_data"), // never cancel the purge job
      mk(`${other}_p1`, other, "pending"),            // different user → skip
    ]);

    const cancelled = await cancel_pending_jobs(uid);
    expect(cancelled).toBe(3); // p1 + p2 + proc

    const stat = async (id: string) =>
      (await db.collection("_jobs").doc(id).get()).data()?.status;
    expect(await stat(`${uid}_p1`)).toBe("cancelled");
    expect(await stat(`${uid}_p2`)).toBe("cancelled");
    expect(await stat(`${uid}_proc`)).toBe("cancelled");
    expect(await stat(`${uid}_done`)).toBe("completed");       // untouched
    expect(await stat(`${uid}_purge`)).toBe("processing");     // purge job untouched
    expect(await stat(`${other}_p1`)).toBe("pending");         // other user untouched
  });

  it("KEEPS the Plaid item + throws (retry) when /item/remove fails — no orphan", async () => {
    const seed = await seedAccountGraph(db, { accounts: 1, txnsPerAccount: 2 });
    await seedExtras(seed.userId, seed.itemDocId);
    mockRemoveItem.mockRejectedValue(new Error("PLAID_API_DOWN")); // transient failure

    await expect(
      purge_user_data_orchestrator(ctx(), {
        user_id: seed.userId, initiated_by: seed.userId, trace_id: "t_fail",
      })
    ).rejects.toThrow(/item\/remove failed/i);

    // The plaid_item (its token) is preserved for the retry — NOT orphaned.
    expect(await countWhere("plaid_items", "userId", seed.userId)).toBe(1);
    // The profile doc is preserved too (purge did not complete).
    expect((await db.collection("users").doc(seed.userId).get()).exists).toBe(true);
    // Other data was still deleted (idempotent — a retry finishes the rest).
    expect(await countWhere("transactions", "userId", seed.userId)).toBe(0);
    const status = (await db.collection("purge_status").doc(seed.userId).get()).data();
    expect(status?.state).toBe("failed");
  });
});
