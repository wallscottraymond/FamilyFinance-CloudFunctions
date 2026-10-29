/**
 * Emulator Integration Test — split writes outside the split edit never overwrite a newer change
 * (Transaction-Integrity proof, app actions T11 / T13 / U16).
 *
 * Tag edits, tag delete and "assign to bill / remove from bill" re-read the transaction inside a
 * Firestore transaction instead of writing back a copy the caller read earlier — so a status tap
 * (or a sync) that landed in between is kept.
 *
 * Prereqs: firebase emulators:exec --only firestore "npx jest --selectProjects emulator --testPathPattern raceSafeSplitWrites"
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();

import { transaction_repo } from "../src/functions/repositories/transaction.repo";

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const U = `rs_u_${RUN}`;
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });

/* eslint-disable @typescript-eslint/naming-convention */
async function seed(id: string, split_over: Record<string, unknown> = {}) {
  await db.collection("transactions").doc(id).set({
    transactionId: id, userId: U, ownerId: U, isActive: true, transactionDate: Timestamp.now(),
    amount: 40, splits: [{ splitId: "s1", amount: 40, spendStatus: "counted", tags: [], ...split_over }],
    tagIds: [], createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
const doc = async (id: string) => (await db.collection("transactions").doc(id).get()).data()!;

describe("split writes outside the split edit are race-safe (emulator)", () => {
  afterAll(async () => { await db.terminate(); });

  it("a tag edit with a STALE copy of the splits keeps a status change that landed since", async () => {
    const id = `rs_tag_${RUN}`;
    await seed(id);
    const stale = (await doc(id)).splits; // the caller read the splits…
    await db.collection("transactions").doc(id).update({ // …then the user tapped Ignore
      splits: [{ ...stale[0], spendStatus: "ignored" }],
    });
    await transaction_repo.write_split_tags(ctx(), id, stale, null, ["tag_a"]);
    const after = await doc(id);
    expect(after.splits[0]).toMatchObject({ spendStatus: "ignored", tags: ["tag_a"] });
    expect(after.tagIds).toEqual(["tag_a"]);
  });

  it("deleting a tag strips it everywhere and keeps everything else", async () => {
    const id = `rs_strip_${RUN}`;
    await seed(id, { tags: [`gone_${RUN}`, "keep"], spendStatus: "refund" });
    await db.collection("transactions").doc(id).update({ tagIds: [`gone_${RUN}`, "keep"] });
    expect(await transaction_repo.strip_tag(ctx(), U, `gone_${RUN}`)).toBe(1);
    const after = await doc(id);
    expect(after.splits[0]).toMatchObject({ tags: ["keep"], spendStatus: "refund" });
    expect(after.tagIds).toEqual(["keep"]);
  });

  it("\"remove from bill\" (detach) is recorded as a manual \"no bill\", on the current splits", async () => {
    const id = `rs_bill_${RUN}`;
    await seed(id, { outflowId: "bill_1", outflowAssignmentSource: "manual" });
    await db.collection("transactions").doc(id).update({ // a status tap landed meanwhile
      splits: [{ splitId: "s1", amount: 40, spendStatus: "ignored", outflowId: "bill_1", outflowAssignmentSource: "manual" }],
    });
    await transaction_repo.pin_split_to_outflow(ctx(), id, "s1", null, U, false, null, true);
    const after = await doc(id);
    expect(after.splits[0]).toMatchObject({ outflowId: null, outflowAssignmentSource: "manual", spendStatus: "ignored" });
    expect(after.splitOutflowIds).toEqual([]);
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
