/**
 * Emulator — "It ended" / "Same bill" / paused bills in WEEKLY and TWICE-A-MONTH views
 * (Convert-To-Recurring fix round).
 *
 * The end interval starts on a MONTH boundary (the month after the last payment), but a view
 * judged suppression by each period's END — so a week straddling the boundary was dropped in full
 * and a payment made BEFORE the end counted nowhere (not paid, not released to budgets). Rule:
 * payments before the end count as paid in every view; nothing is expected after it.
 *
 * Clock: Dec 3 2039 (its own year — no other suite seeds 2039 source periods). Dec 1 2039 is a
 * Thursday, so the week Sun Nov 27 – Sat Dec 3 straddles the end.
 *
 * Paused bills: "It ended" keeps history and ends from the month after the last payment (the pause
 * is superseded, never resumes); "Still a bill" leaves the pause exactly as the user set it.
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { FAKE_CLOCK, makeHarness, plaidTxn, scenarioRecurring } from "./helpers/captureHarness";
import { plaidStream, seedMonthlySourcePeriods } from "./helpers/captureScenario";
import { make_review_item } from "../src/functions/domain/recurring/review_item.service";

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

const DAY = 86400000;
const T0 = Date.UTC(2039, 11, 3, 12); // Dec 3 2039
const END = Date.UTC(2039, 11, 1); // the end interval starts Dec 1
const W48 = { id: "2039W48", start: Date.UTC(2039, 10, 27), end: Date.UTC(2039, 11, 3, 23, 59, 59, 999) }; // straddles
const W52 = { id: "2039W52", start: Date.UTC(2039, 11, 25), end: Date.UTC(2039, 11, 31, 23, 59, 59, 999) };
const BM11B = { id: "2039BM11B", start: Date.UTC(2039, 10, 16), end: Date.UTC(2039, 11, 1) - 1 };
const BM12A = { id: "2039BM12A", start: Date.UTC(2039, 11, 1), end: Date.UTC(2039, 11, 16) - 1 };
const BM12B = { id: "2039BM12B", start: Date.UTC(2039, 11, 16), end: Date.UTC(2040, 0, 1) - 1 };
const NOV = { start: Date.UTC(2039, 10, 1), end: Date.UTC(2039, 11, 1) - 1 };
const DEC = { start: Date.UTC(2039, 11, 1), end: Date.UTC(2040, 0, 1) - 1 };
const JAN = { start: Date.UTC(2040, 0, 1), end: Date.UTC(2040, 1, 1) - 1 };
const FEB = { start: Date.UTC(2040, 1, 1), end: Date.UTC(2040, 2, 1) - 1 };

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
let db: FirebaseFirestore.Firestore;
let manage: any;
let outflow_repo: any;
let derive: any;
let answer: any;
let recurring_review_repo: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("emulator only (dev==prod)");
  jest.useFakeTimers({ ...FAKE_CLOCK, now: T0 });
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  require("../src/functions/orchestrators/plaid/sync_item.orchestrator");
  ({ derive_period_orchestrator: derive } = require("../src/functions/orchestrators/periods/derive_period.orchestrator"));
  ({ manage_recurring_removal_orchestrator: manage } = require("../src/functions/orchestrators/recurring/manage_recurring_removal.orchestrator"));
  ({ outflow_repo } = require("../src/functions/repositories/outflow.repo"));
  ({ answer_recurring_review_item_orchestrator: answer } = require("../src/functions/orchestrators/recurring/answer_recurring_review_item.orchestrator"));
  ({ recurring_review_repo } = require("../src/functions/repositories/recurring_review.repo"));
  db = admin.firestore();
  const months: Array<[number, number]> = [[2039, 8], [2039, 9], [2039, 10], [2039, 11], [2039, 12], [2040, 1], [2040, 2], [2040, 3]];
  await seedMonthlySourcePeriods(db, months);
  const seed = (p: { id: string; start: number; end: number }, type: string) =>
    db.collection("source_periods").doc(p.id).set({
      id: p.id, periodId: p.id, type, year: 2039, index: 0,
      startDate: Timestamp.fromMillis(p.start), endDate: Timestamp.fromMillis(p.end),
    });
  await Promise.all([seed(W48, "weekly"), seed(W52, "weekly"), seed(BM11B, "bi_monthly"), seed(BM12A, "bi_monthly"), seed(BM12B, "bi_monthly")]);
}, 60000);
afterAll(() => jest.useRealTimers());

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });
const days_ago = (ms: number) => Math.round((T0 - ms) / DAY);
const rentTxn = (ids: any, key: string, at_ms: number, amount = 1000) =>
  plaidTxn(ids, { key, account: "chk", amount, days_ago: days_ago(at_ms), name: "LANDLORD LLC", merchant: "Landlord",
    primary: "RENT_AND_UTILITIES", detailed: "RENT_AND_UTILITIES_RENT" }, T0);
const rentStream = (ids: any, name: string, keys: string[], o: Record<string, unknown>) =>
  plaidStream(ids, name, {
    account: "chk", keys, amount: 1000, description: "LANDLORD LLC", merchant: "Landlord", primary: "RENT_AND_UTILITIES",
    detailed: "RENT_AND_UTILITIES_RENT", frequency: "MONTHLY", status: "MATURE", is_active: true,
    first_days_ago: days_ago(Date.UTC(2039, 7, 30, 12)), last_days_ago: days_ago(Date.UTC(2039, 10, 30, 12)), next_days: 27,
    ...o,
  } as any, T0);
const PAYMENTS = [Date.UTC(2039, 7, 30, 12), Date.UTC(2039, 8, 30, 12), Date.UTC(2039, 9, 30, 12), Date.UTC(2039, 10, 30, 12)];

/** A user with ONE v2 rent bill (due the 30th, paid Aug–Nov). */
async function rentUser(tag: string) {
  const h = await makeHarness(db, tag, mocks, { flag: true });
  h.ids.streams.RENT = `${tag}_S_RENT`;
  const keys = PAYMENTS.map((_, i) => `rent${i}`);
  h.postTxns(PAYMENTS.map((ms, i) => rentTxn(h.ids, keys[i], ms)));
  const rec = scenarioRecurring(h.ids, {}, T0);
  h.setRecurring({ ...rec, outflow_streams: [rentStream(h.ids, "RENT", keys, {})], inflow_streams: [] });
  await h.sync("link");
  expect((await db.collection("outflows").doc(h.ids.streams.RENT).get()).data()?.captureRulesVersion).toBe(2);
  return h;
}

const view = async (uid: string, cadence: string, w: { start: number; end: number }) =>
  derive(ctx(), uid, { view_cadence: cadence, window_start_ms: w.start, window_end_ms: w.end, force: true });
const bill = async (uid: string, cadence: string, w: { start: number; end: number }, id: string) => {
  const r = await view(uid, cadence, w);
  const groups = (r.bills.find((b: any) => b.recurring_id === id)?.groups ?? []) as any[];
  return {
    paid: Math.round(groups.reduce((s, g) => s + g.total_paid, 0) * 100) / 100,
    due: Math.round(groups.reduce((s, g) => s + g.total_due, 0) * 100) / 100,
    occ: groups.flatMap((g) => g.occurrences).map((o: any) => [new Date(o.due_ms).toISOString().slice(0, 10), o.paid]),
    ee: Math.round(r.budgets.filter((b: any) => b.is_everything_else)
      .reduce((s: number, b: any) => s + b.periods.reduce((x: number, p: any) => x + (p.spent ?? 0), 0), 0) * 100) / 100,
  };
};
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

describe("It ended / Same bill / paused — weekly + twice-a-month views (emulator)", () => {
  it("\"It ended\": the payment before the end counts as paid in every view; nothing expected after", async () => {
    const h = await rentUser("qzev1");
    const uid = h.ids.userId;
    const RENT = h.ids.streams.RENT;
    await manage(ctx(), uid, [], { id: RENT, action: "end" }, T0, outflow_repo, "recurring_outflow");
    const iv = (await db.collection("outflows").doc(RENT).get()).data()!.removalIntervals;
    expect(iv).toEqual([{ fromMs: END, toMs: null, mode: "going_forward" }]);

    // Monthly: Nov paid; Dec nothing.
    expect(await bill(uid, "monthly", NOV, RENT)).toMatchObject({ paid: 1000, due: 1000, occ: [["2039-11-30", true]] });
    expect(await bill(uid, "monthly", DEC, RENT)).toMatchObject({ paid: 0, due: 0, occ: [] });
    // Weekly: the straddling week keeps the Nov 30 payment as PAID (and it is not budget spend).
    const w48 = await bill(uid, "weekly", W48, RENT);
    expect(w48).toMatchObject({ paid: 1000, due: 1000, occ: [["2039-11-30", true]] });
    expect(w48.ee).toBe(0);
    expect(await bill(uid, "weekly", W52, RENT)).toMatchObject({ paid: 0, due: 0, occ: [] }); // Dec 30: not expected
    // Twice a month: second half of Nov paid; nothing in either half of Dec.
    expect(await bill(uid, "bi_monthly", BM11B, RENT)).toMatchObject({ paid: 1000, due: 1000, occ: [["2039-11-30", true]] });
    expect(await bill(uid, "bi_monthly", BM12A, RENT)).toMatchObject({ paid: 0, due: 0, occ: [] });
    expect(await bill(uid, "bi_monthly", BM12B, RENT)).toMatchObject({ paid: 0, due: 0, occ: [] });
  }, 240000);

  it("\"Same bill\" (keep separate + old ended): each payment counts once in every view; the old one expects nothing after", async () => {
    const h = await rentUser("qzev2");
    const uid = h.ids.userId;
    const OLD = h.ids.streams.RENT;
    h.ids.streams.RENT2 = `${h.ids.tag}_S_RENT2`;
    // The old stream stops after Nov 30; a new one starts Dec 2 at a new price.
    const keys = PAYMENTS.map((_, i) => `rent${i}`);
    h.postTxns([rentTxn(h.ids, "rentnew0", Date.UTC(2039, 11, 2, 12), 1100)]);
    const rec = scenarioRecurring(h.ids, {}, T0);
    h.setRecurring({
      ...rec,
      outflow_streams: [
        rentStream(h.ids, "RENT", keys, { is_active: false, next_days: null }),
        rentStream(h.ids, "RENT2", ["rentnew0"], { amount: 1100, first_days_ago: 1, last_days_ago: 1, next_days: 30 }),
      ],
      inflow_streams: [],
    });
    await h.sync("switch");
    const items = (await db.collection("recurring_review_items").where("userId", "==", uid).get()).docs.map((d) => d.data());
    const q = items.filter((i) => i.kind === "same_bill");
    expect(q.map((i) => i.recordId)).toEqual([OLD]);
    await answer(ctx(), uid, { item_id: q[0].id, answer: "keep_separate" }, T0);
    await manage(ctx(), uid, [], { id: OLD, action: "end" }, T0, outflow_repo, "recurring_outflow");
    await h.sync("kept");
    const NEW = h.ids.streams.RENT2;
    expect((await db.collection("outflows").doc(NEW).get()).data()?.captureRulesVersion).toBe(2);

    // Weekly, the straddling week: old paid Nov 30, new paid Dec 2 — both, once; no budget spend.
    const w_old = await bill(uid, "weekly", W48, OLD);
    const w_new = await bill(uid, "weekly", W48, NEW);
    expect(w_old).toMatchObject({ paid: 1000, due: 1000, occ: [["2039-11-30", true]] });
    expect(w_new.paid).toBe(1100);
    expect(w_old.ee).toBe(0);
    expect(await bill(uid, "weekly", W52, OLD)).toMatchObject({ due: 0, occ: [] });
    // Twice a month.
    expect(await bill(uid, "bi_monthly", BM11B, OLD)).toMatchObject({ paid: 1000, occ: [["2039-11-30", true]] });
    expect(await bill(uid, "bi_monthly", BM12A, OLD)).toMatchObject({ due: 0, occ: [] });
    expect((await bill(uid, "bi_monthly", BM12A, NEW)).paid).toBe(1100);
    expect(await bill(uid, "bi_monthly", BM12B, OLD)).toMatchObject({ due: 0, occ: [] });
    // Monthly: Dec has only the new bill.
    expect(await bill(uid, "monthly", DEC, OLD)).toMatchObject({ due: 0, occ: [] });
    expect((await bill(uid, "monthly", DEC, NEW)).paid).toBe(1100);
    expect(await bill(uid, "monthly", NOV, OLD)).toMatchObject({ paid: 1000 });
  }, 240000);

  const stillABill = (h: { ids: { userId: string; chk: string; itemDocId: string } }, rid: string) =>
    make_review_item({
      user_id: h.ids.userId, kind: "still_a_bill", direction: "outflow", source: "plaid", status: "open", answer: null,
      subject_key: rid, vendor_key: "landlord", account_id: h.ids.chk, plaid_item_doc_id: h.ids.itemDocId, stream_id: rid,
      record_id: rid, name: "Landlord", amount: 1000, frequency: "monthly", plaid_status: "MATURE", category: null,
      transaction_ids: [], next_due_ms: null, user_frequency: null, resolved_at_ms: null,
    }, T0);

  it("PAUSED bill answered \"It ended\": history kept; ends from the month after the last payment; the pause never resumes", async () => {
    const h = await rentUser("qzev3");
    const uid = h.ids.userId;
    const RENT = h.ids.streams.RENT;
    const RESUME = Date.UTC(2040, 1, 15);
    await manage(ctx(), uid, [], { id: RENT, action: "pause", resume_ms: RESUME }, T0, outflow_repo, "recurring_outflow");
    const item = stillABill(h, RENT);
    await recurring_review_repo.upsert_items(ctx(), [item]);
    await answer(ctx(), uid, { item_id: item.id, answer: "it_ended" }, T0);
    const iv = (await db.collection("outflows").doc(RENT).get()).data()!.removalIntervals;
    // The pause is closed at the answer (its elapsed span stays a gap) and the end starts Dec 1.
    expect(iv).toEqual([
      { fromMs: END, toMs: T0, mode: "paused" },
      { fromMs: END, toMs: null, mode: "going_forward" },
    ]);
    expect(await bill(uid, "monthly", NOV, RENT)).toMatchObject({ paid: 1000, occ: [["2039-11-30", true]] });
    expect(await bill(uid, "weekly", W48, RENT)).toMatchObject({ paid: 1000, occ: [["2039-11-30", true]] });
    expect(await bill(uid, "monthly", DEC, RENT)).toMatchObject({ due: 0, occ: [] });
    expect(await bill(uid, "monthly", FEB, RENT)).toMatchObject({ due: 0, occ: [] }); // never resumes
  }, 240000);

  it("PAUSED bill answered \"Still a bill\": the pause stays exactly as the user set it", async () => {
    const h = await rentUser("qzev4");
    const uid = h.ids.userId;
    const RENT = h.ids.streams.RENT;
    const RESUME = Date.UTC(2040, 1, 15);
    await manage(ctx(), uid, [], { id: RENT, action: "pause", resume_ms: RESUME }, T0, outflow_repo, "recurring_outflow");
    const before = (await db.collection("outflows").doc(RENT).get()).data()!.removalIntervals;
    expect(before).toEqual([{ fromMs: END, toMs: RESUME, mode: "paused" }]);
    const item = stillABill(h, RENT);
    await recurring_review_repo.upsert_items(ctx(), [item]);
    await answer(ctx(), uid, { item_id: item.id, answer: "still_a_bill" }, T0);
    const after = (await db.collection("outflows").doc(RENT).get()).data()!;
    expect(after.removalIntervals).toEqual(before);
    expect(after.plaidInactiveAckAt).toBeDefined();
    expect(await bill(uid, "monthly", NOV, RENT)).toMatchObject({ paid: 1000 });
    expect(await bill(uid, "monthly", DEC, RENT)).toMatchObject({ due: 0, occ: [] }); // paused
    expect(await bill(uid, "monthly", JAN, RENT)).toMatchObject({ due: 0, occ: [] }); // paused
    expect((await bill(uid, "monthly", FEB, RENT)).due).toBeGreaterThan(0); // resumes Feb 15 as set
  }, 240000);
});
