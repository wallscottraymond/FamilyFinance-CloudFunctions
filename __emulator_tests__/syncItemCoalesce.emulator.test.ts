/**
 * Emulator — enqueue_item_sync coalescing keeps a RECURRING request (Convert-To-Recurring fix).
 *
 * "Track" on a review item enqueues a recurring re-sync of the item; coalesce_job used to merge it
 * into any pending sync_item job for that item — including a non-recurring one (a webhook's), so
 * the recurring refresh was dropped and the bill never appeared. Now a recurring request only
 * merges into a recurring pending run; everything else merges as before.
 *
 * D30 (user-approved 2026-10-16): this is a deliberate existing-behavior change for ALL users — a
 * dropped refresh is fixed at the cost of at most one extra sync in a burst.
 */
import * as admin from "firebase-admin";

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
let db: FirebaseFirestore.Firestore;
let enqueue_item_sync: (input: any) => Promise<void>;
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("emulator only (dev==prod)");
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  db = admin.firestore();
  ({ enqueue_item_sync } = require("../src/functions/orchestrators/plaid/sync_item.orchestrator"));
});
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const pending_for = async (item: string) =>
  (await db.collection("_jobs").where("payload.item_doc_id", "==", item).where("status", "==", "pending").get())
    .docs.map((d) => d.data().payload.recurring as boolean).sort();

describe("enqueue_item_sync coalescing (emulator)", () => {
  it("a recurring request never merges into a pending NON-recurring run", async () => {
    const item = `qzco_a_${Date.now()}`;
    await enqueue_item_sync({ item_doc_id: item, user_id: "u", recurring: false, delay_seconds: 600, reason: "webhook" });
    await enqueue_item_sync({ item_doc_id: item, user_id: "u", recurring: true, reason: "review_track" });
    expect(await pending_for(item)).toEqual([false, true]);
    // A second recurring request merges into the recurring one.
    await enqueue_item_sync({ item_doc_id: item, user_id: "u", recurring: true, reason: "review_track" });
    expect(await pending_for(item)).toEqual([false, true]);
  });

  it("a non-recurring request still merges into any pending run (recurring or not)", async () => {
    const item = `qzco_b_${Date.now()}`;
    await enqueue_item_sync({ item_doc_id: item, user_id: "u", recurring: true, delay_seconds: 600 });
    await enqueue_item_sync({ item_doc_id: item, user_id: "u", recurring: false });
    expect(await pending_for(item)).toEqual([true]);
    const item2 = `qzco_c_${Date.now()}`;
    await enqueue_item_sync({ item_doc_id: item2, user_id: "u", recurring: false, delay_seconds: 600 });
    await enqueue_item_sync({ item_doc_id: item2, user_id: "u", recurring: false });
    expect(await pending_for(item2)).toEqual([false]);
  });
});
