/**
 * account_repo.upsert_from_plaid — a removed account stays removed (Code-Health-Review P2-H1).
 *
 * Removing one account soft-deletes its doc (isActive:false) while the bank connection stays
 * linked, so every balance sync still returns that account from Plaid. The upsert used to look
 * the account up among ACTIVE docs only, miss it, and create a brand-new active copy.
 */
import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "family-budget-app-cb59b" });
}
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true }); // as in src/index.ts

import { account_repo } from "../src/functions/repositories/account.repo";

const ctx = () => ({
  trace_id: `t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
  span_id: `s_${Date.now()}`,
});
const uniq = (p: string) => `${p}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

const plaidAccount = (account_id: string, current: number) => ({
  account_id,
  name: "Checking",
  type: "depository",
  subtype: "checking",
  mask: "1234",
  balances: { current, available: current, iso_currency_code: "USD" },
});

async function seedAccount(userId: string, itemId: string, accountId: string, removed: boolean) {
  const id = uniq("acct");
  /* eslint-disable @typescript-eslint/naming-convention */
  await db.collection("accounts").doc(id).set({
    id, userId, groupIds: [], accountId, plaidAccountId: accountId, itemId,
    name: "Checking", accountType: "depository", currentBalance: 100,
    isActive: !removed, isDeleted: removed,
    createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now(),
  });
  /* eslint-enable @typescript-eslint/naming-convention */
  return id;
}

const docsFor = async (userId: string, accountId: string) =>
  (await db.collection("accounts").where("userId", "==", userId)
    .where("accountId", "==", accountId).get()).docs;

describe("account_repo.upsert_from_plaid (emulator)", () => {
  afterAll(async () => { await db.terminate(); });

  it("a removed account is left alone: no new copy, no balance write", async () => {
    const userId = uniq("u");
    const itemId = uniq("item");
    const accountId = uniq("plaidacct");
    const removedId = await seedAccount(userId, itemId, accountId, true);

    const res = await account_repo.upsert_from_plaid(
      ctx(), [plaidAccount(accountId, 555)], itemId, userId, { id: "ins_1", name: "Bank" }
    );

    const docs = await docsFor(userId, accountId);
    expect(docs.map((d) => d.id)).toEqual([removedId]);
    expect(docs[0].data().isActive).toBe(false);
    expect(docs[0].data().currentBalance).toBe(100);
    expect(res.created).toBe(0);
    expect(res.updated).toBe(0);
    expect(res.results).toEqual([]);
  });

  it("active accounts still update and new accounts are still created (same call)", async () => {
    const userId = uniq("u");
    const itemId = uniq("item");
    const activeAcct = uniq("plaidacct");
    const newAcct = uniq("plaidacct");
    const activeId = await seedAccount(userId, itemId, activeAcct, false);

    const res = await account_repo.upsert_from_plaid(
      ctx(), [plaidAccount(activeAcct, 250), plaidAccount(newAcct, 75)],
      itemId, userId, { id: "ins_1", name: "Bank" }
    );

    expect(res.updated).toBe(1);
    expect(res.created).toBe(1);
    const active = await docsFor(userId, activeAcct);
    expect(active.map((d) => d.id)).toEqual([activeId]);
    expect(active[0].data().currentBalance).toBe(250);
    const created = await docsFor(userId, newAcct);
    expect(created).toHaveLength(1);
    expect(created[0].data().isActive).toBe(true);
  });

  // Code-Health-Review P2-M7: creation was check-then-create with a random id, so two balance
  // syncs running at once (cron + webhook) could both see "no doc" and create two.
  it("two concurrent upserts of a new account create ONE doc", async () => {
    const userId = uniq("u");
    const itemId = uniq("item");
    const accountId = uniq("plaidacct");
    await Promise.all([1, 2, 3].map(() =>
      account_repo.upsert_from_plaid(ctx(), [plaidAccount(accountId, 70)], itemId, userId, { id: "ins_1", name: "Bank" })
    ));
    const docs = await docsFor(userId, accountId);
    expect(docs).toHaveLength(1);
    expect(docs[0].data().isActive).toBe(true);
  });
});

