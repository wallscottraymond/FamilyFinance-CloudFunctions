/**
 * Emulator — Add Bill / Add Income on the new path with the flag ON (Convert-To-Recurring D43,
 * commit 8). Flag OFF is byte-identical (the addBillUnchanged golden). With the flag on: the record
 * is the same record plus the v2 stamp; a D1 key only from a real transaction (never a typed name);
 * never a retro-link; ids stay manual_<uuid>; two same-vendor Add Bills are two bills; an existing
 * hand-added bill is untouched; income settings are kept; a forged accountId / transaction is refused;
 * the create is stamped (periods inline, one bump).
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern d43AddBillIncome"
 */
import * as admin from "firebase-admin";
import { FAKE_CLOCK, makeHarness, plaidTxn, seedMonths, setFlag } from "./helpers/captureHarness";
import { NOW_MS, normalizeDoc } from "./helpers/captureScenario";
import { startCounting } from "./helpers/firestoreCounter";

const mockSync = jest.fn();
const mockRecurring = jest.fn();
jest.mock("../src/functions/integrations/plaid", () => {
  const actual = jest.requireActual("../src/functions/integrations/plaid");
  return {
    ...actual,
    sync_transactions: (...a: unknown[]) => mockSync(...a),
    fetch_recurring_transactions: (...a: unknown[]) => mockRecurring(...a),
    fetch_plaid_accounts: async () => ({ accounts: [], item_id: "x", request_id: "r" }),
    safe_fetch_liabilities: async () => null,
  };
});
jest.mock("../src/utils/encryption", () => {
  const actual = jest.requireActual("../src/utils/encryption");
  return { ...actual, decryptAccessToken: () => "decrypted-token" };
});

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
let db: FirebaseFirestore.Firestore;
let create_manual_outflow: any;
let createManualInflow: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("emulator only (dev==prod)");
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  require("../src/functions/orchestrators/plaid/sync_item.orchestrator");
  require("../src/functions/orchestrators/periods/derive_period.orchestrator");
  ({ create_manual_outflow } = require("../src/functions/entry/callable/create_manual_outflow.entry"));
  ({ createManualInflow } = require("../src/functions/inflows/inflow_periods/api/createManualInflow"));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const settle = () => new Promise((r) => setTimeout(r, 300));
const bill = (uid: string, data: Record<string, unknown>) => (create_manual_outflow as any).run({ auth: { uid, token: {} }, data, rawRequest: {} });
const income = (uid: string, data: Record<string, unknown>) => (createManualInflow as any).run({ auth: { uid, token: {} }, data, rawRequest: {} });
const BASE = { name: "Rent", amount: 1200, frequency: "monthly", due_day: 20, expense_type: "housing", is_essential: true };
const ll = (ids: Parameters<typeof plaidTxn>[0], key: string, days_ago: number, amount = 1200) =>
  plaidTxn(ids, { key, account: "chk", amount, days_ago, name: "LANDLORD LLC", merchant: "Landlord LLC", primary: "RENT_AND_UTILITIES", detailed: "RENT_AND_UTILITIES_RENT" });

describe("D43: Add Bill / Add Income with the flag ON (emulator)", () => {
  it("Add Bill: the same record + the v2 stamp; no key without a real transaction; stamped create, periods inline, one bump", async () => {
    const off = await makeHarness(db, "qzd43a", mocks, { flag: false });
    const on = await makeHarness(db, "qzd43b", mocks, { flag: true });
    const a = (await bill(off.ids.userId, BASE)).data.outflow_id as string;
    const c = startCounting();
    const b = (await bill(on.ids.userId, BASE)).data.outflow_id as string;
    await settle();
    const k = c.stop();
    expect(b).toMatch(/^manual_/);
    expect(k.writes_by.user_data_versions).toBe(1);
    expect((await db.collection("outflow_periods").where("outflowId", "==", b).get()).size).toBeGreaterThan(0); // inline
    const da = (await db.collection("outflows").doc(a).get()).data()!;
    const db_ = (await db.collection("outflows").doc(b).get()).data()!;
    const strip = (d: Record<string, unknown>, tag: string) => {
      const { captureRulesVersion, plaidIsActive, syncRunId, lastWriteSource, id, ownerId, createdBy, updatedBy, ...rest } = normalizeDoc(d, tag) as any;
      void captureRulesVersion; void plaidIsActive; void syncRunId; void lastWriteSource; void id; void ownerId; void createdBy; void updatedBy;
      return rest;
    };
    expect(db_.captureRulesVersion).toBe(2);
    expect(da.captureRulesVersion).toBeUndefined();
    expect(strip(db_, "qzd43b")).toEqual(strip(da, "qzd43a")); // every other field identical
    expect(db_.vendorKey).toBeUndefined(); // a typed name never makes a D1 key
    expect(db_.accountId).toBe("");
  }, 240000);

  it("with a real transaction: account + D1 key, NO retro-link; the next payment (any amount) links; two same-vendor Add Bills are two bills", async () => {
    const h = await makeHarness(db, "qzd43c", mocks, { flag: true });
    await h.sync("link");
    h.postTxns([ll(h.ids, "o", 12), ll(h.ids, "s", 42)]);
    await h.sync("rent");
    const uid = h.ids.userId;
    const one = (await bill(uid, { ...BASE, source_transaction_id: `plaid_${h.ids.txn("o")}` })).data.outflow_id as string;
    const two = (await bill(uid, { ...BASE, name: "Rent 2", amount: 90, source_transaction_id: `plaid_${h.ids.txn("o")}` })).data.outflow_id as string;
    expect(one).not.toBe(two);
    const d = (await db.collection("outflows").doc(one).get()).data()!;
    expect([d.accountId, d.vendorKey, d.retroTxnIds, d.convertedFromTxnId]).toEqual([h.ids.chk, "landlord llc", undefined, undefined]);
    // no retro-link: the existing payments are untouched
    for (const key of ["o", "s"]) expect((await h.txn(key)).splits[0].outflowId ?? null).toBeNull();
    // the next payment: D1 → the closest-amount bill, deterministically
    h.postTxns([ll(h.ids, "n1", 0, 1190), ll(h.ids, "n2", 0, 95)]);
    await h.sync("next");
    expect((await h.txn("n1")).splits[0].outflowId).toBe(one);
    expect((await h.txn("n2")).splits[0].outflowId).toBe(two);
  }, 240000);

  it("an existing hand-added bill is untouched when the flag turns on; a forged account / transaction is refused", async () => {
    const h = await makeHarness(db, "qzd43d", mocks, { flag: false });
    const uid = h.ids.userId;
    const old = (await bill(uid, BASE)).data.outflow_id as string;
    const before = (await db.collection("outflows").doc(old).get()).data()!;
    await setFlag(db, [uid]);
    await h.sync("link");
    await h.sync("again");
    const after = (await db.collection("outflows").doc(old).get()).data()!;
    const n = (d: Record<string, unknown>) => normalizeDoc(d, "qzd43d");
    expect(n(after)).toEqual(n(before));
    // someone else's account / transaction
    const other = await makeHarness(db, "qzd43e", mocks, { flag: true });
    await other.sync("link");
    const forged_account = await bill(uid, { ...BASE, account_id: other.ids.chk });
    expect(forged_account.success).toBe(false);
    expect(forged_account.error?.code).toBe("ACCOUNT_NOT_YOURS");
    const forged_txn = await bill(uid, { ...BASE, source_transaction_id: `plaid_${other.ids.txn("spot0")}` });
    expect(forged_txn.error?.code).toBe("SOURCE_NOT_YOURS");
    await expect(income(uid, { name: "X", amount: 5, frequency: "MONTHLY", firstExpectedDate: "2037-10-20", incomeType: "salary", accountId: other.ids.chk }))
      .rejects.toMatchObject({ code: "permission-denied" });
    expect((await db.collection("outflows").where("ownerId", "==", uid).where("source", "==", "manual").get()).size).toBe(1); // nothing was created by the refusals
  }, 240000);

  it("Add Income: v2 stamp + every setting kept (hourly / commission config, variability, isUserClassified, isPrivate); own account only", async () => {
    const h = await makeHarness(db, "qzd43f", mocks, { flag: true });
    const uid = h.ids.userId;
    const r = await income(uid, {
      name: "Tutoring", amount: 300, frequency: "WEEKLY", firstExpectedDate: "2037-10-16", incomeType: "hourly",
      hourlyConfig: { rate: 30, hours: 10 }, incomeVariability: "high", accountId: h.ids.chk,
    });
    const d = (await db.collection("inflows").doc(r.inflowId).get()).data()!;
    expect(d).toMatchObject({
      captureRulesVersion: 2, source: "manual", accountId: h.ids.chk, incomeType: "hourly", incomeVariability: "high",
      isUserClassified: true, isPrivate: true, hourlyConfig: { rate: 30, hours: 10 }, commissionConfig: null,
      frequency: "weekly", userCustomName: "Tutoring", plaidItemId: "", isUserModified: false,
    });
    expect(d.vendorKey).toBeUndefined();
    expect((await db.collection("inflow_periods").where("inflowId", "==", r.inflowId).get()).size).toBeGreaterThan(0);
    void NOW_MS;
  }, 240000);
});
