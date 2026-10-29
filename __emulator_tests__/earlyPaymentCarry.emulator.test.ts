/**
 * Emulator — D28: an early payment before a removal / "It ended" cut-off counts (round 4 test 11).
 *
 * Clock Oct 15 2042 (no other suite seeds 2042 source periods). Oct 1 2042 is a Wednesday, so the
 * week Sun Sep 28 – Sat Oct 4 straddles the cut-off. One bill, due the 1st, paid Aug 1, Sep 1 and
 * EARLY on Sep 29 for Oct 1; then removed going forward (from Oct 1) or ended ("It ended": from
 * Oct 1). OLD (flag off) and v2 records. In every case the Sep 29 payment:
 *   - is linked to the bill by the engine (its month isn't removed) → never budget spend;
 *   - counts as PAID in September in the derive: monthly (Sep shows both payments), weekly (the
 *     straddling week) and twice-a-month (Sep 16–30) — exactly once in each view;
 *   - counts as paid in September in the STORED periods (stored reconcile): the Sep month expects
 *     and has 2, the straddling week is turned on (carryActive) with 1 paid, Sep 16–30 has 1; Oct
 *     stays off — so the assign-to-bill picker (isActive == true) matches the period page.
 */
import * as admin from "firebase-admin";
import { FAKE_CLOCK, makeHarness, plaidTxn, scenarioRecurring } from "./helpers/captureHarness";
import { plaidStream } from "./helpers/captureScenario";
import { halves, months, seedPeriods, weeks } from "./helpers/sourcePeriods";

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
const DAY = 86400000;
const T = Date.UTC(2042, 9, 15, 12);
const MONTHS: Array<[number, number]> = [[2042, 7], [2042, 8], [2042, 9], [2042, 10], [2042, 11], [2042, 12]];
const WEEKS = weeks(Date.UTC(2042, 6, 27), Date.UTC(2042, 11, 31)); // Sun Jul 27 2042 →
const HALVES = halves(MONTHS);
const W_SEP28 = WEEKS.find((w) => w.start === Date.UTC(2042, 8, 28))!;
const BM_SEP_B = HALVES.find((h) => h.id === "2042BM09B")!;
const M_SEP = months(MONTHS).find((m) => m.id === "2042M09")!;
const M_OCT = months(MONTHS).find((m) => m.id === "2042M10")!;
const SEP = { start: M_SEP.start, end: M_SEP.end };

let db: FirebaseFirestore.Firestore;
let manage: any;
let outflow_repo: any;
let derive: any;
let reconcile: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("emulator only (dev==prod)");
  jest.useFakeTimers({ ...FAKE_CLOCK, now: T });
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  require("../src/functions/orchestrators/plaid/sync_item.orchestrator");
  ({ derive_period_orchestrator: derive } = require("../src/functions/orchestrators/periods/derive_period.orchestrator"));
  ({ manage_recurring_removal_orchestrator: manage } = require("../src/functions/orchestrators/recurring/manage_recurring_removal.orchestrator"));
  ({ outflow_repo } = require("../src/functions/repositories"));
  ({ reconcile_recurring_periods_orchestrator: reconcile } = require("../src/functions/orchestrators/recurring/reconcile_recurring_periods.orchestrator"));
  db = admin.firestore();
  await seedPeriods(db, [...months(MONTHS), ...WEEKS, ...HALVES]);
}, 60000);
afterAll(() => jest.useRealTimers());

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });
const days_ago = (ms: number) => Math.round((T - ms) / DAY);
const PAID = [Date.UTC(2042, 7, 1, 12), Date.UTC(2042, 8, 1, 12), Date.UTC(2042, 8, 29, 12)];

async function caseUser(tag: string, flag: boolean, action: "remove" | "end") {
  const h = await makeHarness(db, tag, mocks, { flag });
  h.ids.streams.ERL = `${tag}_S_ERL`;
  const keys = PAID.map((_, i) => `erl${i}`);
  h.postTxns(PAID.map((ms, i) => plaidTxn(h.ids, { key: keys[i], account: "chk", amount: 100, days_ago: days_ago(ms),
    name: "MORTGAGE CO", merchant: "Mortgage Co", primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" }, T)));
  h.setRecurring({ ...scenarioRecurring(h.ids, {}, T), outflow_streams: [plaidStream(h.ids, "ERL", {
    account: "chk", keys, amount: 100, description: "MORTGAGE CO", merchant: "Mortgage Co", primary: "LOAN_PAYMENTS",
    detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT", frequency: "MONTHLY", status: "MATURE", is_active: true,
    first_days_ago: days_ago(PAID[0]), last_days_ago: days_ago(PAID[2]), next_days: Math.round((Date.UTC(2042, 10, 1, 12) - T) / DAY),
  } as any, T)], inflow_streams: [] });
  await h.sync("link");
  const bill = h.ids.streams.ERL;
  expect((await db.collection("outflows").doc(bill).get()).data()?.captureRulesVersion ?? null).toBe(flag ? 2 : null);
  const input = action === "remove" ? { action: "remove", mode: "going_forward" } : { action: "end" };
  await manage(ctx(), h.ids.userId, [], { id: bill, ...input }, T, outflow_repo, "recurring_outflow");
  const intervals = (await db.collection("outflows").doc(bill).get()).data()?.removalIntervals;
  expect(intervals.map((i: any) => i.fromMs)).toEqual([Date.UTC(2042, 9, 1)]); // cut-off Oct 1 either way
  return { h, uid: h.ids.userId, bill, early_doc: `plaid_${h.ids.txn("erl2")}` };
}

const view = (uid: string, cadence: string, w: { start: number; end: number }) =>
  derive(ctx(), uid, { view_cadence: cadence, window_start_ms: w.start, window_end_ms: w.end, force: true });
const groupOf = (r: any, bill: string, pid: string) => r.bills.find((b: any) => b.recurring_id === bill)?.groups.find((g: any) => g.period_id === pid);
const occ = (g: any) => (g?.occurrences ?? []).map((o: any) => [new Date(o.due_ms).toISOString().slice(0, 10), o.paid]);
const countOf = (r: any, txn_doc: string) =>
  r.bills.flatMap((b: any) => b.groups.flatMap((g: any) => g.occurrences)).filter((o: any) => o.paid && o.transaction_id === txn_doc).length;
const period = async (bill: string, sp: { id: string }) => (await db.collection("outflow_periods").doc(`${bill}_${sp.id}`).get()).data()!;

describe("D28 — an early payment before a removal / end cut-off counts (emulator)", () => {
  for (const flag of [false, true]) {
    for (const action of ["remove", "end"] as const) {
      it(`${flag ? "v2" : "old"} record, ${action === "end" ? "\"It ended\"" : "removed"}: paid in Sep in every view + stored, counted once`, async () => {
        const { uid, bill, early_doc } = await caseUser(`qzd28${flag ? "v" : "o"}${action[0]}`, flag, action);
        // Engine: linked to the bill (Sep isn't removed) → never budget spend.
        const t = (await db.collection("transactions").doc(early_doc).get()).data()!;
        expect(t.splits.map((s: any) => s.outflowId)).toEqual([bill]);

        // Derive: monthly / weekly / twice-a-month.
        const m = await view(uid, "monthly", SEP);
        expect(occ(groupOf(m, bill, M_SEP.id))).toEqual([["2042-09-01", true], ["2042-09-29", true]]);
        expect(countOf(m, early_doc)).toBe(1);
        const oct = await view(uid, "monthly", { start: M_OCT.start, end: M_OCT.end });
        expect(groupOf(oct, bill, M_OCT.id)).toBeUndefined();
        expect(countOf(oct, early_doc)).toBe(0);
        const w = await view(uid, "weekly", { start: W_SEP28.start, end: W_SEP28.end });
        expect(occ(groupOf(w, bill, W_SEP28.id))).toEqual([["2042-09-29", true]]);
        expect(countOf(w, early_doc)).toBe(1);
        const bm = await view(uid, "bi_monthly", { start: BM_SEP_B.start, end: BM_SEP_B.end });
        expect(occ(groupOf(bm, bill, BM_SEP_B.id))).toEqual([["2042-09-29", true]]);
        expect(countOf(bm, early_doc)).toBe(1);

        // Stored periods (the reconcile the recurring-update trigger runs after a removal).
        await reconcile(ctx(), { recurring_id: bill, recurring_type: "outflow", user_id: uid, trace_id: "t" });
        const sep = await period(bill, M_SEP);
        expect([sep.isActive, sep.reconciliation.occurrencesExpected, sep.reconciliation.occurrencesPaid, sep.reconciliation.status])
          .toEqual([true, 2, 2, "complete"]);
        const wk = await period(bill, W_SEP28);
        expect([wk.isActive, wk.carryActive, wk.reconciliation.occurrencesPaid]).toEqual([true, true, 1]);
        const half = await period(bill, BM_SEP_B);
        expect([half.isActive, half.reconciliation.occurrencesPaid]).toEqual([true, 1]);
        expect((await period(bill, M_OCT)).isActive).toBe(false);
        // Picker parity: the stored active periods holding the payment are exactly the derive's.
        const active = (await db.collection("outflow_periods").where("outflowId", "==", bill).where("isActive", "==", true).get()).docs.map((d) => d.id);
        expect(active).toEqual(expect.arrayContaining([`${bill}_${M_SEP.id}`, `${bill}_${W_SEP28.id}`, `${bill}_${BM_SEP_B.id}`]));
        // Idempotent: a second reconcile writes nothing more.
        await reconcile(ctx(), { recurring_id: bill, recurring_type: "outflow", user_id: uid, trace_id: "t2" });
        expect((await period(bill, W_SEP28)).updatedAt).toEqual(wk.updatedAt);

        // Restored → the carried week is no longer needed: active by the month rule, mark dropped.
        await manage(ctx(), uid, [], { id: bill, action: "restore" }, T + DAY, outflow_repo, "recurring_outflow");
        await reconcile(ctx(), { recurring_id: bill, recurring_type: "outflow", user_id: uid, trace_id: "t3" });
        const wk2 = await period(bill, W_SEP28);
        expect([wk2.isActive, wk2.carryActive]).toEqual([true, false]);
      }, 240000);
    }
  }
});
