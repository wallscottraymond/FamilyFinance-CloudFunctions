/**
 * Emulator — Plaid later detects a bill the user converted (D3 / D42 "absorb, never save", F16).
 * One bill: the stream is recorded on the converted record (absorbedStreams / absorbedTxnIds), never
 * saved; its payments link to the converted bill (even ones whose vendor key differs); re-syncs and
 * a drifting Plaid average write NOTHING; the flag being off changes nothing (D16); a hand-added
 * (Add Bill) record, another account or another vendor is never absorbed.
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern autoMergeConverted"
 */
import * as admin from "firebase-admin";
import { FAKE_CLOCK, OCT, clearFlagFor, makeHarness, paidTotal, plaidTxn, scenarioRecurring, seedMonths } from "./helpers/captureHarness";
import { NOW_MS } from "./helpers/captureScenario";
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
let convert: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("emulator only (dev==prod)");
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  require("../src/functions/orchestrators/plaid/sync_item.orchestrator");
  ({ convert_transaction_to_recurring_orchestrator: convert } = require("../src/functions/orchestrators/recurring/convert_transaction_to_recurring.orchestrator"));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const DAY = 86400000;
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });
const ago = (y: number, m: number, d: number) => Math.round((Date.UTC(2037, 9, 15) - Date.UTC(y, m - 1, d)) / DAY);
const ll = (ids: Parameters<typeof plaidTxn>[0], key: string, days_ago: number, o: Record<string, unknown> = {}) => ({
  ...plaidTxn(ids, { key, account: "chk", amount: 1500, days_ago, name: "LANDLORD LLC", merchant: "Landlord LLC",
    primary: "RENT_AND_UTILITIES", detailed: "RENT_AND_UTILITIES_RENT" }), ...o,
});
const RENT = { name: "Rent", amount: 1500, frequency: "monthly", next_due_date: "2037-11-03", link_past: true };
const settle = () => new Promise((r) => setTimeout(r, 300));

/** The scenario's recurring response plus ONE extra Plaid stream for the landlord. */
function with_stream(h: any, o: { keys: string[]; avg?: number; merchant?: string; account?: string; status?: string; id?: string }) {
  const rec = scenarioRecurring(h.ids);
  const id = o.id ?? `${h.ids.tag}_S_LL`;
  rec.outflow_streams.push({
    ...rec.outflow_streams[0], stream_id: id, merchant_name: o.merchant ?? "Landlord LLC", description: o.merchant ? o.merchant.toUpperCase() : "LANDLORD LLC",
    account_id: o.account ?? h.ids.chk, transaction_ids: o.keys.map(h.ids.txn), status: o.status ?? "MATURE", is_active: true,
    average_amount: { amount: o.avg ?? 1500, iso_currency_code: "USD" }, last_amount: { amount: o.avg ?? 1500, iso_currency_code: "USD" },
    personal_finance_category: { primary: "RENT_AND_UTILITIES", detailed: "RENT_AND_UTILITIES_RENT", confidence_level: "HIGH" },
  });
  return { rec, id };
}

async function converted_user(tag: string, flag = true) {
  const h = await makeHarness(db, tag, mocks, { flag });
  await h.sync("link");
  h.postTxns([ll(h.ids, "oct", ago(2037, 10, 3)), ll(h.ids, "sep", ago(2037, 9, 3)), ll(h.ids, "aug", ago(2037, 8, 3))]);
  await h.sync("rent");
  const r = await convert(ctx(), h.ids.userId, { transaction_id: `plaid_${h.ids.txn("oct")}`, ...RENT }, NOW_MS);
  return { h, bill: r.id as string };
}
const bills_of = async (uid: string) => (await db.collection("outflows").where("ownerId", "==", uid).get()).docs.filter((d) => d.data().plaidItemId !== "" ? true : true);

describe("Plaid detects a converted bill (emulator)", () => {
  it("F16: one bill — the stream is absorbed, not saved; its payments (even a differently-keyed one) link to the converted bill; no double total", async () => {
    const { h, bill } = await converted_user("qzam1");
    const uid = h.ids.userId;
    // a late-arriving payment of the stream whose name/merchant differs (a different vendor key)
    h.postTxns([ll(h.ids, "odd", 1, { name: "LL PMT 7731", merchant_name: null })]);
    const { rec, id } = with_stream(h, { keys: ["oct", "sep", "aug", "odd"] });
    h.setRecurring(rec);
    await h.sync("detect");
    await settle();
    expect((await db.collection("outflows").doc(id).get()).exists).toBe(false); // never saved
    const doc = (await db.collection("outflows").doc(bill).get()).data()!;
    expect(doc.absorbedStreams).toEqual([expect.objectContaining({ streamId: id, state: "absorbed" })]);
    expect((doc.absorbedTxnIds as string[]).sort()).toEqual(["oct", "sep", "aug", "odd"].map(h.ids.txn).sort());
    // the converted bill keeps the USER's numbers (Plaid's are never copied)
    expect([doc.averageAmount, doc.userCustomName, doc.source]).toEqual([1500, "Rent", "manual"]);
    expect((await h.txn("odd")).splits[0].outflowId).toBe(bill); // linked via the absorbed ids
    expect((await db.collection("outflows").where("ownerId", "==", uid).where("vendorKey", "==", "landlord llc").get()).size).toBe(1);
    expect(paidTotal(await h.bill(OCT, bill))).toBe(1500); // once
  }, 240000);

  it("3 re-syncs and 5 drifting Plaid averages write NOTHING to the bill (0 bumps, no extra item reads); growth writes once", async () => {
    const { h, bill } = await converted_user("qzam2");
    const keys = ["oct", "sep", "aug"];
    // control: what a steady sync reads of review items BEFORE the stream exists
    const cc = startCounting();
    await h.sync("control");
    await settle();
    const control_reads = cc.stop().reads_by.recurring_review_items ?? 0;
    const first = with_stream(h, { keys });
    h.setRecurring(first.rec);
    await h.sync("detect");
    await settle();
    for (let i = 0; i < 5; i++) {
      const { rec } = with_stream(h, { keys, avg: 1500 + i * 3.17 });
      h.setRecurring(rec);
      const c = startCounting();
      await h.sync(`again${i}`);
      await settle();
      const k = c.stop();
      expect(k.writes_by.outflows ?? 0).toBe(0);
      expect(k.writes_by.user_data_versions ?? 0).toBe(0);
      expect(k.reads_by.recurring_review_items ?? 0).toBe(control_reads); // an absorbed stream costs no item lookups
    }
    // the stream gains a payment: exactly one stamped write to the converted bill
    h.postTxns([ll(h.ids, "new", 0)]);
    const { rec } = with_stream(h, { keys: [...keys, "new"] });
    h.setRecurring(rec);
    const c = startCounting();
    await h.sync("grow");
    await settle();
    expect(c.stop().writes_by.outflows).toBe(1);
    expect(((await db.collection("outflows").doc(bill).get()).data()!.absorbedTxnIds as string[])).toContain(h.ids.txn("new"));
    expect((await h.txn("new")).splits[0].outflowId).toBe(bill);
  }, 300000);

  it("flag OFF still absorbs (D16: the record decides, not the flag)", async () => {
    const { h, bill } = await converted_user("qzam3");
    await clearFlagFor(db, h.ids.userId);
    const { rec, id } = with_stream(h, { keys: ["oct", "sep"] });
    h.setRecurring(rec);
    await h.sync("detect");
    expect((await db.collection("outflows").doc(id).get()).exists).toBe(false);
    expect((await db.collection("outflows").doc(bill).get()).data()!.absorbedStreams).toHaveLength(1);
  }, 240000);

  it("not absorbed: another vendor, another account, a hand-added (Add Bill) record; a low-confidence stream of the vendor makes no tile", async () => {
    const { h, bill } = await converted_user("qzam4");
    // another vendor / another account → saved as their own bills
    const other = with_stream(h, { keys: [], merchant: "Somebody Else", id: `${h.ids.tag}_S_OTH` });
    const sav = with_stream(h, { keys: [], account: h.ids.sav, id: `${h.ids.tag}_S_SAV` });
    other.rec.outflow_streams.push(sav.rec.outflow_streams[sav.rec.outflow_streams.length - 1]);
    h.setRecurring(other.rec);
    await h.sync("others");
    expect((await db.collection("outflows").doc(`${h.ids.tag}_S_OTH`).get()).exists).toBe(true);
    expect((await db.collection("outflows").doc(`${h.ids.tag}_S_SAV`).get()).exists).toBe(true);
    expect((await db.collection("outflows").doc(bill).get()).data()!.absorbedStreams ?? []).toEqual([]);
    // a low-confidence stream of the converted vendor: absorbed, no "possible bill" tile
    const early = with_stream(h, { keys: ["oct"], status: "EARLY_DETECTION", id: `${h.ids.tag}_S_EARLY` });
    h.setRecurring(early.rec);
    await h.sync("early");
    expect((await db.collection("outflows").doc(`${h.ids.tag}_S_EARLY`).get()).exists).toBe(false);
    expect((await db.collection("recurring_review_items").where("userId", "==", h.ids.userId).where("kind", "==", "suggested").where("vendorKey", "==", "landlord llc").get()).size).toBe(0);
    // a hand-added Add Bill record (no vendor key) is never an absorber: its twin stream is saved as its own bill
    const h2 = await makeHarness(db, "qzam5", mocks, { flag: false });
    await h2.sync("link");
    const { create_manual_outflow_orchestrator } = require("../src/functions/orchestrators/recurring/create_manual_outflow.orchestrator");
    const made = await create_manual_outflow_orchestrator({ ...ctx(), user_id: h2.ids.userId, idempotency_key: "k", input: { name: "Landlord LLC", merchant_name: "Landlord LLC", amount: 1500, frequency: "monthly", expense_type: "housing", is_essential: true, due_day: 3 } });
    const twin = with_stream(h2, { keys: [] });
    h2.setRecurring(twin.rec);
    await h2.sync("twin");
    expect((await db.collection("outflows").doc(twin.id).get()).exists).toBe(true);
    expect((await db.collection("outflows").doc(made.outflow_id).get()).data()!.absorbedStreams).toBeUndefined();
  }, 300000);
});

describe("undo an absorb", () => {
  it("declined: the converted bill lets the stream go and the next sync creates a separate bill for it", async () => {
    const { h, bill } = await converted_user("qzam6");
    const { rec, id } = with_stream(h, { keys: ["oct", "sep"] });
    h.setRecurring(rec);
    await h.sync("detect");
    const { undo_recurring_merge_orchestrator: undo } = require("../src/functions/orchestrators/recurring/undo_recurring_merge.orchestrator");
    await undo(ctx(), h.ids.userId, { kind: "outflow", mode: "absorb", record_id: bill, stream_id: id }, NOW_MS);
    const doc = (await db.collection("outflows").doc(bill).get()).data()!;
    expect(doc.absorbedStreams).toEqual([expect.objectContaining({ streamId: id, state: "declined" })]);
    expect(doc.absorbedTxnIds).toEqual([]);
    await h.sync("separate");
    expect((await db.collection("outflows").doc(id).get()).exists).toBe(true);
    expect((await undo(ctx(), h.ids.userId, { kind: "outflow", mode: "absorb", record_id: bill, stream_id: id }, NOW_MS)).no_op).toBe(true);
  }, 240000);
});
void bills_of;
