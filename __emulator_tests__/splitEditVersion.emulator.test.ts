/**
 * Split edits never overwrite a newer version of the transaction (Code-Health-Review P4-H1).
 *
 * The app reads the transaction, edits its splits and sends the WHOLE splits array. Anything
 * written in between (the assignment engine, a Plaid update, tags, a bill pin, another edit) was
 * silently overwritten. The app now sends `baseUpdatedAtMs` (the `updatedAt` of the copy it
 * edited); the server refuses with `aborted` when the stored transaction changed since, and the
 * app re-reads and re-applies. Without it (an older app build) the edit applies as before.
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true }); // as in src/index.ts

import { updateTransactionSplits } from "../src/functions/transactions/api/crud/updateTransactionSplits";

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const U = `sv_u_${RUN}`;
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (data: unknown): Promise<any> => (updateTransactionSplits as any).run({
  data, auth: { uid: U, token: {} }, rawRequest: {},
});

/* eslint-disable @typescript-eslint/naming-convention */
async function seedTxn(id: string) {
  await db.collection("transactions").doc(id).set({
    transactionId: id, userId: U, ownerId: U, isActive: true, transactionDate: ts("2026-06-15T12:00:00Z"),
    amount: 40, merchantName: "Store", name: "Store", type: "expense", accountId: "acc",
    splits: [{
      splitId: "s1", id: "s1", amount: 40, isDefault: true,
      plaidPrimaryCategory: "FOOD_AND_DRINK", plaidDetailedCategory: "FOOD_AND_DRINK_GROCERIES",
      categorySource: "plaid", tags: [],
    }],
    createdAt: Timestamp.now(), updatedAt: ts("2026-06-15T12:00:00.123Z"),
  });
  return (await db.collection("transactions").doc(id).get()).data()!;
}
/* eslint-enable @typescript-eslint/naming-convention */
const read = async (id: string) => (await db.collection("transactions").doc(id).get()).data()!;
const twoSplits = (s0: Record<string, unknown>) => [
  { ...s0, amount: 25 },
  { splitId: "s2", id: "s2", amount: 15, isDefault: false, plaidPrimaryCategory: "FOOD_AND_DRINK",
    plaidDetailedCategory: "FOOD_AND_DRINK_GROCERIES", categorySource: "plaid", tags: [] },
];

describe("updateTransactionSplits version check (P4-H1, emulator)", () => {
  beforeAll(async () => {
    await db.collection("users").doc(U).set({ email: "x@x.com" });
  });
  afterAll(async () => { await db.terminate(); });

  it("refuses an edit made from an older copy (aborted) and changes nothing", async () => {
    const id = `sv_stale_${RUN}`;
    const t0 = await seedTxn(id);
    const base = (t0.updatedAt as Timestamp).toMillis();
    // Something else writes the transaction after the app read it (e.g. a tag + engine re-stamp).
    await db.collection("transactions").doc(id).update({ tagIds: ["t1"], updatedAt: ts("2026-06-15T12:05:00Z") });
    await expect(call({ transactionId: id, splits: twoSplits(t0.splits[0]), baseUpdatedAtMs: base }))
      .rejects.toMatchObject({ code: "aborted" });
    const after = await read(id);
    expect(after.splits).toHaveLength(1);
    expect(after.tagIds).toEqual(["t1"]); // the other write survives
  });

  it("applies an edit made from the current copy", async () => {
    const id = `sv_ok_${RUN}`;
    const t0 = await seedTxn(id);
    await call({ transactionId: id, splits: twoSplits(t0.splits[0]), baseUpdatedAtMs: (t0.updatedAt as Timestamp).toMillis() });
    expect((await read(id)).splits).toHaveLength(2);
  });

  it("a second edit from the copy the first edit replaced is refused", async () => {
    const id = `sv_twice_${RUN}`;
    const t0 = await seedTxn(id);
    const base = (t0.updatedAt as Timestamp).toMillis();
    await call({ transactionId: id, splits: twoSplits(t0.splits[0]), baseUpdatedAtMs: base });
    await expect(call({ transactionId: id, splits: [{ ...t0.splits[0], amount: 40 }], baseUpdatedAtMs: base }))
      .rejects.toMatchObject({ code: "aborted" });
    expect((await read(id)).splits).toHaveLength(2);
  });

  it("an older app build (no baseUpdatedAtMs) still saves as before", async () => {
    const id = `sv_legacy_${RUN}`;
    const t0 = await seedTxn(id);
    await db.collection("transactions").doc(id).update({ updatedAt: ts("2026-06-15T12:09:00Z") });
    await call({ transactionId: id, splits: twoSplits(t0.splits[0]) });
    expect((await read(id)).splits).toHaveLength(2);
  });
});
