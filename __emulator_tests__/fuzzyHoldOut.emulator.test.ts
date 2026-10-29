/**
 * Emulator — X3: an unanswered suggestion's payments never fuzzy-link to an OLD bill.
 *
 * An old Sunbit bill exists (made before the release, still active). Plaid then starts a NEW Sunbit
 * stream it is unsure of (EARLY_DETECTION) and a new payment posts. Under v2 the new stream is a
 * suggestion (no record), so — without the hold-out — the payment would fall to the fuzzy matcher,
 * whose candidates are every bill period in the window, and "Sunbit" alone links it to the OLD
 * bill (old bill reads paid, payment vanishes from budgets: a D13 leak). With the hold-out:
 *   - engine: no link stored; the payment counts in budgets (Everything Else);
 *   - derive: a stale auto link on it is ignored; a MANUAL pin still wins;
 *   - the held-out set changing bumps the derive version;
 *   - control: drop the hold-out and the very same payment does fuzzy-link to the old bill.
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern fuzzyHoldOut"
 */
import * as admin from "firebase-admin";
import {
  FAKE_CLOCK, OCT, clearFlagFor, makeHarness, paidTotal, plaidTxn, scenarioRecurring, seedMonths, setFlag,
} from "./helpers/captureHarness";
import { startCounting } from "./helpers/firestoreCounter";
import { plaidStream } from "./helpers/captureScenario";

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

let db: FirebaseFirestore.Firestore;
/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
let assign: (ctx: unknown, input: unknown) => Promise<any>;
let answer: (ctx: any, uid: string, input: any, now: number) => Promise<any>;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("emulator only (dev==prod)");
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  require("../src/functions/orchestrators/plaid/sync_item.orchestrator");
  require("../src/functions/orchestrators/periods/derive_period.orchestrator");
  ({ assign_transaction_orchestrator: assign } = require("../src/functions/orchestrators/transactions/assign_transaction.orchestrator"));
  ({ answer_recurring_review_item_orchestrator: answer } = require("../src/functions/orchestrators/recurring/answer_recurring_review_item.orchestrator"));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const version = async (uid: string) => ((await db.collection("user_data_versions").doc(uid).get()).data()?.version as number) ?? 0;

describe("X3 — held-out payments never fuzzy-link to an old bill (emulator)", () => {
  it("engine + derive hold it out; manual pin wins; bump on change; control proves the leak", async () => {
    const tag = "qzhold";
    const mocks = { mockSync, mockRecurring };
    // 1. Link with the flag OFF and Sunbit MATURE → an OLD Sunbit bill (with periods).
    const h = await makeHarness(db, tag, mocks, { flag: false });
    h.setRecurring(scenarioRecurring(h.ids, { SUNBIT: { status: "MATURE" } }));
    await h.sync("link");
    const OLD = h.ids.streams.SUNBIT;
    expect((await db.collection("outflows").doc(OLD).get()).data()?.captureRulesVersion).toBeUndefined();
    const sep_paid = paidTotal(await h.bill({ start: Date.UTC(2037, 8, 1), end: Date.UTC(2037, 9, 1) - 1 }, OLD));

    // 2. Flag on; Plaid keeps the old stream AND starts a new, unsure Sunbit stream; a payment posts.
    await setFlag(db, [h.ids.userId]);
    h.ids.streams.SUNBIT2 = `${tag}_S_SUNBIT2`;
    const rec = scenarioRecurring(h.ids, { SUNBIT: { status: "MATURE" } });
    rec.outflow_streams.push(plaidStream(h.ids, "SUNBIT2", {
      account: "chk", keys: ["sunbitnew"], amount: 50, description: "SUNBIT", merchant: "Sunbit",
      primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT", frequency: "MONTHLY",
      status: "EARLY_DETECTION", is_active: true, first_days_ago: 0, last_days_ago: 0, next_days: 30,
    }));
    h.setRecurring(rec);
    h.postTxns([plaidTxn(h.ids, { key: "sunbitnew", account: "chk", amount: 50, days_ago: 0, name: "SUNBIT",
      merchant: "Sunbit", primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT" })]);
    const ee_before = await h.eeSpent(OCT);
    const v0 = await version(h.ids.userId);
    await h.sync("new_stream");
    expect(await version(h.ids.userId)).toBeGreaterThan(v0); // the held-out set changed → bump

    // Engine: stored with NO bill link; counted in budgets.
    const t = await h.txn("sunbitnew");
    expect(t?.splits[0].outflowId ?? null).toBeNull();
    expect((await db.collection("outflows").doc(h.ids.streams.SUNBIT2).get()).exists).toBe(false);
    expect(await h.eeSpent(OCT)).toBe(Math.round((ee_before + 50) * 100) / 100);
    // The old bill isn't paid by it (Oct: its own earlier payment only).
    const oct_old = await h.bill(OCT, OLD);
    expect((oct_old?.groups ?? []).flatMap((g: { occurrences: Array<{ transaction_id?: string }> }) => g.occurrences)
      .map((o: { transaction_id?: string }) => o.transaction_id)).not.toContain(`plaid_${h.ids.txn("sunbitnew")}`);
    expect(paidTotal(await h.bill({ start: Date.UTC(2037, 8, 1), end: Date.UTC(2037, 9, 1) - 1 }, OLD))).toBe(sep_paid);

    // Derive: a stale AUTO link on the held-out payment is ignored on read…
    const ref = db.collection("transactions").doc(`plaid_${h.ids.txn("sunbitnew")}`);
    const splits = t!.splits.map((s: Record<string, unknown>) => ({ ...s, outflowId: OLD, outflowAssignmentSource: "auto" }));
    await ref.update({ splits, splitOutflowIds: [OLD] });
    expect(await h.eeSpent(OCT)).toBe(Math.round((ee_before + 50) * 100) / 100);
    // …but the user's MANUAL pin wins.
    await ref.update({ splits: splits.map((s: Record<string, unknown>) => ({ ...s, outflowAssignmentSource: "manual" })) });
    expect(await h.eeSpent(OCT)).toBe(ee_before);

    // Control: without the hold-out the same payment fuzzy-links to the OLD bill (the leak X3 closes).
    await ref.update({ splits: splits.map((s: Record<string, unknown>) => ({ ...s, outflowId: null, outflowAssignmentSource: "auto" })), splitOutflowIds: [] });
    await db.collection("_recurring_review_state").doc(h.ids.userId).update({ suppressedTxnIds: [] });
    await assign({ trace_id: "ctl", span_id: "s" }, { user_id: h.ids.userId, transaction_id: ref.id });
    expect((await ref.get()).data()?.splits[0].outflowId).toBe(OLD);
  }, 180000);

  it("X11: a flag-off user with no v2 records never reads the review state doc (assignment batch + derive)", async () => {
    const h = await makeHarness(db, "qzhoff", { mockSync, mockRecurring }, { flag: false });
    await h.sync("link");
    // Even if a state doc exists (e.g. a stale one), a flag-off, all-old user never reads it.
    await db.collection("_recurring_review_state").doc(h.ids.userId).set({ suppressedTxnIds: ["x"] });
    // Warm the per-instance flag cache (it is shared with every other flag check on the instance).
    require("../src/functions/infrastructure/feature_flags").invalidate_flag_cache();
    const txn_id = `plaid_${h.ids.txn("spot0")}`;
    await assign({ trace_id: "warm", span_id: "s" }, { user_id: h.ids.userId, transaction_id: txn_id });

    const a = startCounting();
    await assign({ trace_id: "off", span_id: "s" }, { user_id: h.ids.userId, transaction_id: txn_id });
    const ac = a.stop();
    const d = startCounting();
    await h.derive(OCT); // force: true → a derive cache miss
    const dc = d.stop();
    // eslint-disable-next-line no-console
    console.info(`[X11 measured] assignment batch reads=${ac.reads} derive reads=${dc.reads} state-doc reads=${(ac.reads_by._recurring_review_state ?? 0) + (dc.reads_by._recurring_review_state ?? 0)}`);
    expect(ac.reads_by._recurring_review_state ?? 0).toBe(0);
    expect(dc.reads_by._recurring_review_state ?? 0).toBe(0);
    expect(ac.reads_by._feature_flags ?? 0).toBe(0); // cached per instance
  }, 180000);

  it("D16: v2 records keep the hold-out even after the flag is turned off (one state read each)", async () => {
    const tag = "qzhv2";
    const h = await makeHarness(db, tag, { mockSync, mockRecurring }, { flag: true });
    await h.sync("link"); // v2 records
    h.ids.streams.SUNBIT2 = `${tag}_S_SUNBIT2`;
    const rec = scenarioRecurring(h.ids);
    rec.outflow_streams.push(plaidStream(h.ids, "SUNBIT2", {
      account: "chk", keys: ["sunbitnew"], amount: 50, description: "SUNBIT", merchant: "Sunbit",
      primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT", frequency: "MONTHLY",
      status: "EARLY_DETECTION", is_active: true, first_days_ago: 0, last_days_ago: 0, next_days: 30,
    }));
    h.setRecurring(rec);
    h.postTxns([plaidTxn(h.ids, { key: "sunbitnew", account: "chk", amount: 50, days_ago: 0, name: "SUNBIT",
      merchant: "Sunbit", primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT" })]);
    await h.sync("new_stream");
    const held = (await db.collection("_recurring_review_state").doc(h.ids.userId).get()).data()?.suppressedTxnIds ?? [];
    expect(held).toContain(h.ids.txn("sunbitnew"));

    await clearFlagFor(db, h.ids.userId);
    const ref = db.collection("transactions").doc(`plaid_${h.ids.txn("sunbitnew")}`);
    const a = startCounting();
    await assign({ trace_id: "v2off", span_id: "s" }, { user_id: h.ids.userId, transaction_id: ref.id });
    const ac = a.stop();
    expect(ac.reads_by._recurring_review_state).toBe(1);
    expect((await ref.get()).data()?.splits[0].outflowId ?? null).toBeNull();
    // Derive: a stale auto link to the (v2) Sunbit bill is still ignored on read.
    const t = (await ref.get()).data()!;
    const ee_before = await h.eeSpent(OCT);
    await ref.update({
      splits: t.splits.map((sp: Record<string, unknown>) => ({ ...sp, outflowId: h.ids.streams.SUNBIT, outflowAssignmentSource: "auto" })),
      splitOutflowIds: [h.ids.streams.SUNBIT],
    });
    const d = startCounting();
    expect(await h.eeSpent(OCT)).toBe(ee_before);
    expect(d.stop().reads_by._recurring_review_state).toBe(1);
  }, 180000);

  it("Track: the payments stay held out between the answer and the bill being created", async () => {
    const tag = "qzhtrk";
    const h = await makeHarness(db, tag, { mockSync, mockRecurring }, { flag: false });
    h.setRecurring(scenarioRecurring(h.ids, { SUNBIT: { status: "MATURE" } }));
    await h.sync("link"); // an OLD Sunbit bill
    const OLD = h.ids.streams.SUNBIT;
    await setFlag(db, [h.ids.userId]);
    h.ids.streams.SUNBIT2 = `${tag}_S_SUNBIT2`;
    const rec = scenarioRecurring(h.ids, { SUNBIT: { status: "MATURE" } });
    rec.outflow_streams.push(plaidStream(h.ids, "SUNBIT2", {
      account: "chk", keys: ["sunbitnew"], amount: 50, description: "SUNBIT", merchant: "Sunbit",
      primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT", frequency: "MONTHLY",
      status: "EARLY_DETECTION", is_active: true, first_days_ago: 0, last_days_ago: 0, next_days: 30,
    }));
    h.setRecurring(rec);
    h.postTxns([plaidTxn(h.ids, { key: "sunbitnew", account: "chk", amount: 50, days_ago: 0, name: "SUNBIT",
      merchant: "Sunbit", primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT" })]);
    await h.sync("new_stream");
    const items = (await db.collection("recurring_review_items").where("userId", "==", h.ids.userId).get()).docs.map((d) => d.data());
    const sug = items.find((i) => i.kind === "suggested" && i.transactionIds?.includes(h.ids.txn("sunbitnew")))!;
    expect(sug).toBeDefined();
    await answer({ trace_id: "trk", span_id: "s" }, h.ids.userId, { item_id: sug.id, answer: "track", frequency: "monthly" }, Date.now());

    // Between the answer and the re-sync: still held out — a re-assign does NOT fuzzy-link it to OLD.
    const held = (await db.collection("_recurring_review_state").doc(h.ids.userId).get()).data()?.suppressedTxnIds ?? [];
    expect(held).toContain(h.ids.txn("sunbitnew"));
    const ref = db.collection("transactions").doc(`plaid_${h.ids.txn("sunbitnew")}`);
    await assign({ trace_id: "gap", span_id: "s" }, { user_id: h.ids.userId, transaction_id: ref.id });
    expect((await ref.get()).data()?.splits[0].outflowId ?? null).toBeNull();
    expect((await ref.get()).data()?.splits[0].outflowId).not.toBe(OLD);

    // The re-sync creates the v2 bill → released, and the payment pays the NEW bill.
    await h.sync("after_track");
    expect((await db.collection("outflows").doc(h.ids.streams.SUNBIT2).get()).data()?.captureRulesVersion).toBe(2);
    const after = (await db.collection("_recurring_review_state").doc(h.ids.userId).get()).data()?.suppressedTxnIds ?? [];
    expect(after).not.toContain(h.ids.txn("sunbitnew"));
    expect((await ref.get()).data()?.splits[0].outflowId).toBe(h.ids.streams.SUNBIT2);
  }, 180000);
});
