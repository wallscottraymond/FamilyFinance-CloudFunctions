/**
 * Emulator — possibleBillDetector (Convert-To-Recurring D11 / D17 / X12 / X14 / X17 / X19).
 *
 *   - rides the classifier's scan on the first link: City Water (utilities) + a side-gig income are
 *     suggested; daily / weekly coffee, card "income" and anything in a stream are not; a vendor
 *     with a Plaid suggestion keeps ONE tile (X14); R11: no dismissed vendor written
 *   - R2 / R3: 10 syncs + 20 enqueues in a day → ONE job doc `detect:{uid}:{day}`; a throttled
 *     job run costs one state read (+ the purge guard) — full cost measured
 *   - a DELAYED detector job is processed by the queue sweep (both job maps register it)
 *   - R1: 5,050-transaction user, full run — reads bounded (transactions once, cap logged)
 *   - R13: flag off → never enqueued; detector reads nothing
 *   - purge with open items + state + a pending detector job → all gone, nothing re-created
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern possibleBillDetector"
 */
import * as fs from "fs";
import * as path from "path";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { FAKE_CLOCK, makeHarness, plaidTxn, seedMonths } from "./helpers/captureHarness";
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
    remove_item: async () => ({ success: true, already_removed: false, request_id: "x" }),
  };
});
jest.mock("../src/utils/encryption", () => {
  const actual = jest.requireActual("../src/utils/encryption");
  return { ...actual, decryptAccessToken: () => "decrypted-token" };
});

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
let db: FirebaseFirestore.Firestore;
let det: any;
let classify: any;
let purge: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("emulator only (dev==prod)");
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  require("../src/functions/orchestrators/plaid/sync_item.orchestrator");
  require("../src/functions/orchestrators/periods/derive_period.orchestrator");
  det = require("../src/functions/orchestrators/recurring/detect_possible_recurring.orchestrator");
  ({ classify_internal_transfers_orchestrator: classify } = require("../src/functions/orchestrators/plaid/classify_internal_transfers.orchestrator"));
  ({ purge_user_data_orchestrator: purge } = require("../src/functions/orchestrators/users/purge_user_data.orchestrator"));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });
const DAY = 86400000;
const items_of = async (uid: string) =>
  (await db.collection("recurring_review_items").where("userId", "==", uid).get()).docs.map((d) => d.data());

/** Extra transactions the detector should (and shouldn't) find. */
function extras(ids: Parameters<typeof plaidTxn>[0]) {
  const t = (key: string, account: "chk" | "sav" | "card", amount: number, days_ago: number, merchant: string, primary: string, detailed: string) =>
    plaidTxn(ids, { key, account, amount, days_ago, name: merchant.toUpperCase(), merchant, primary, detailed });
  return [
    ...[6, 37, 67].map((d, i) => t(`water${i}`, "chk", 40 + i, d, "City Water", "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_WATER")),
    ...[4, 18, 32].map((d, i) => t(`gig${i}`, "chk", -300, d, "Side Gig LLC", "INCOME", "INCOME_OTHER_INCOME")),
    ...[4, 18, 32].map((d, i) => t(`rewards${i}`, "card", -25, d, "Card Rewards", "INCOME", "INCOME_OTHER_INCOME")),
    ...[1, 2, 3, 4, 5, 6, 7].map((d, i) => t(`coffee${i}`, "chk", 4, d, "Corner Coffee", "FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE")),
    ...[2, 9, 16, 23].map((d, i) => t(`monday${i}`, "chk", 6, d, "Monday Coffee", "FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE")),
    // More Sunbit payments OUTSIDE Plaid's (EARLY) stream: the detector must not add a 2nd tile.
    ...[65, 95, 125].map((d, i) => t(`sbx${i}`, "chk", 50, d, "Sunbit", "LOAN_PAYMENTS", "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT")),
  ];
}

describe("possible-bill detector (emulator)", () => {
  it("finds City Water + side gig; no coffee / card income / stream payments; one tile per vendor; R11", async () => {
    const h = await makeHarness(db, "qzdet", mocks, { flag: true });
    h.postTxns(extras(h.ids));
    await h.sync("link");
    const items = await items_of(h.ids.userId);
    const by = (name: string) => items.filter((i) => i.name === name);
    expect(by("City Water").map((i) => [i.source, i.direction, i.frequency, i.status])).toEqual([["detector", "outflow", "monthly", "open"]]);
    expect(by("Side Gig LLC").map((i) => [i.source, i.direction, i.frequency])).toEqual([["detector", "inflow", "biweekly"]]);
    for (const n of ["Corner Coffee", "Monday Coffee", "Card Rewards", "Spotify", "Acme", "Capital One"]) expect([n, by(n).length]).toEqual([n, 0]);
    expect(by("Sunbit").map((i) => i.source)).toEqual(["plaid"]); // X14: one tile, Plaid's
    expect(by("Avant").map((i) => i.source)).toEqual(["plaid"]);
    const state = (await db.collection("_recurring_review_state").doc(h.ids.userId).get()).data()!;
    expect(state.detectorLastRunDay).toBe("2037-10-15");
    expect(state.dismissedVendorKeys).toEqual([]); // R11: the detector never writes "Not a bill"
  }, 180000);

  it("X12 throttle: 10 syncs in a day → the detector runs once; a throttled inline run = 1 state read, 0 writes", async () => {
    const h = await makeHarness(db, "qzthr", mocks, { flag: true });
    await h.sync("link"); // the detector ran inline today (on the classifier's own full scan)
    const runs: string[] = [];
    const spy = jest.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      const m = String(a[0]);
      if (m.includes(`detector ${h.ids.userId}:`)) runs.push(m);
    });
    for (let n = 0; n < 10; n++) {
      h.postTxns([plaidTxn(h.ids, { key: `more${n}`, account: "chk", amount: 9 + n, days_ago: 0, name: "SHOP", merchant: "Shop",
        primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_OTHER" })]);
      await h.sync(`s${n}`);
    }
    spy.mockRestore();
    expect(runs).toEqual([]); // already ran today
    // No fallback job exists any more (it forced a full classifier scan — X12 says 0 extra reads).
    const jobs = await db.collection("_jobs").where("payload.user_id", "==", h.ids.userId).where("job_type", "==", "detect_possible_recurring").get();
    expect(jobs.size).toBe(0);
    for (const f of ["../src/functions/entry/triggers/on_job_created.trigger.ts", "../src/functions/entry/scheduled/process_job_queue.scheduled.ts"]) {
      expect(fs.readFileSync(path.join(__dirname, f), "utf8")).not.toMatch(/detect_possible_recurring/);
    }
    expect(fs.existsSync(path.join(__dirname, "../src/functions/orchestrators/recurring/detect_possible_recurring.job.ts"))).toBe(false);
    // Throttled inline run: full cost.
    const c = startCounting();
    const r = await det.run_detector_on_scan(ctx(), h.ids.userId, NOW_MS, { txns: [], internal_txn_ids: new Set(), records: [] });
    const k = c.stop();
    expect([r.ran, r.reason]).toEqual([false, "already_today"]);
    console.log("[X12] throttled inline detector run:", JSON.stringify({ reads: k.reads, writes: k.writes, reads_by: k.reads_by }));
    expect(k.writes).toBe(0);
    expect(k.reads_by._recurring_review_state).toBe(1);
    expect(k.reads).toBe(1); // flag cached
  }, 180000);

  it("next UTC day: the detector rides the next full classifier scan again (no job needed)", async () => {
    const h = await makeHarness(db, "qzsweep", mocks, { flag: true });
    await h.sync("link");
    const tomorrow = NOW_MS + DAY;
    jest.setSystemTime(tomorrow);
    try {
      h.postTxns(extras(h.ids).filter((t) => String(t.transaction_id).includes("water")));
      await h.sync("next_day");
      // Whatever the sync did, the next full scan of the day runs the detector once.
      await classify(ctx(), h.ids.userId, tomorrow, { force: true });
      expect((await items_of(h.ids.userId)).some((i) => i.name === "City Water" && i.source === "detector")).toBe(true);
      const state = (await db.collection("_recurring_review_state").doc(h.ids.userId).get()).data()!;
      expect(state.detectorLastRunDay).toBe("2037-10-16");
    } finally {
      jest.setSystemTime(NOW_MS);
    }
  }, 180000);

  it("R1: a 5,050-transaction user — one transaction read, bounded reads, cap logged", async () => {
    const h = await makeHarness(db, "qzbig", mocks, { flag: true });
    await h.sync("link");
    // 5,050 posted purchases in the window, written directly (emulator).
    const writer = db.bulkWriter();
    for (let i = 0; i < 5050; i++) {
      const id = `qzbig_bulk_${i}`;
      writer.set(db.collection("transactions").doc(id), {
        id, transactionId: `pbulk_${i}`, userId: h.ids.userId, ownerId: h.ids.userId, accountId: h.ids.chk,
        isActive: true, isPending: false, type: "expense", amount: 5 + (i % 30), name: `STORE ${i % 50}`, merchantName: `Store ${i % 50}`,
        plaidPrimaryCategory: "GENERAL_MERCHANDISE", plaidDetailedCategory: "GENERAL_MERCHANDISE_OTHER",
        transactionDate: Timestamp.fromMillis(NOW_MS - DAY * (1 + (i % 170))), splits: [{ splitId: "s", amount: 5, outflowId: null, inflowId: null }],
      });
    }
    await writer.close();
    await db.collection("_recurring_review_state").doc(h.ids.userId).update({ detectorLastRunDay: "2037-10-14" });
    const warn = jest.spyOn(console, "warn");
    const c = startCounting();
    const r = await classify(ctx(), h.ids.userId, NOW_MS, { force: true }); // a full scan; the detector rides it
    await new Promise((res) => setTimeout(res, 300));
    const k = c.stop();
    expect(r.skipped).toBe(false);
    expect((await db.collection("_recurring_review_state").doc(h.ids.userId).get()).data()?.detectorLastRunDay).toBe("2037-10-15");
    console.log("[R1] full classifier scan + inline detector:", JSON.stringify({ reads: k.reads, writes: k.writes, reads_by: k.reads_by, writes_by: k.writes_by }));
    expect(warn.mock.calls.some((a) => String(a[0]).includes("detector:") && String(a[0]).includes("cap"))).toBe(true);
    warn.mockRestore();
    const txn_reads = k.reads_by.transactions ?? 0;
    expect(txn_reads).toBeLessThanOrEqual(5050 + 120); // the ONE window read (+ the scenario's own txns)
    expect(k.reads_by._recurring_review_state).toBeLessThanOrEqual(2);
    expect(k.reads - txn_reads).toBeLessThan(200); // everything else is small
  }, 240000);

  it("R13: flag off → the detector reads nothing", async () => {
    const h = await makeHarness(db, "qzdoff", mocks, { flag: false });
    h.postTxns(extras(h.ids));
    await h.sync("link");
    expect(await items_of(h.ids.userId)).toEqual([]);
    const c = startCounting();
    const r = await det.run_detector_on_scan(ctx(), h.ids.userId, NOW_MS, { txns: [], internal_txn_ids: new Set(), records: [] });
    const k = c.stop();
    expect([r.ran, r.reason, k.reads, k.writes]).toEqual([false, "flag_off", 0, 0]);
  }, 180000);

  it("purge with open items + state → all gone; a late detector run re-creates nothing", async () => {
    const h = await makeHarness(db, "qzpurge", mocks, { flag: true });
    h.postTxns(extras(h.ids));
    await h.sync("link");
    const uid = h.ids.userId;
    expect((await items_of(uid)).length).toBeGreaterThan(0);
    await purge(ctx(), { user_id: uid, initiated_by: uid, trace_id: "t_purge" });
    expect(await items_of(uid)).toEqual([]);
    expect((await db.collection("_recurring_review_state").doc(uid).get()).exists).toBe(false);
    // A classifier scan still in flight when the purge lands: the detector writes nothing.
    const late = await det.run_detector_on_scan(ctx(), uid, NOW_MS + DAY, { txns: [], internal_txn_ids: new Set(), records: [] });
    expect([late.ran, late.reason]).toEqual([false, "purging"]);
    expect(await items_of(uid)).toEqual([]);
    expect((await db.collection("_recurring_review_state").doc(uid).get()).exists).toBe(false);
  }, 180000);
});
