/**
 * Emulator — review round 5: stored periods carry EXACTLY what the period page's matcher assigns
 * across a removal / "It ended" / pause cut-off (defects 3–5, D31, tests 3, 4, 5, 8, 9).
 *
 * Clock Oct 15 2042 (Oct 1 2042 is a Wednesday: the week Sun Sep 28 – Sat Oct 4 straddles the
 * cut-off). Each case is one user with one bill; the stored periods are reconciled (the job the
 * recurring-update trigger runs) and compared with the derived period page.
 */
import * as admin from "firebase-admin";
import { FAKE_CLOCK, makeHarness, plaidTxn, scenarioRecurring } from "./helpers/captureHarness";
import { plaidStream } from "./helpers/captureScenario";
import { halves, months, seedPeriods, weeks } from "./helpers/sourcePeriods";
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
const DAY = 86400000;
const T = Date.UTC(2042, 9, 15, 12);
const MONTHS: Array<[number, number]> = [[2042, 7], [2042, 8], [2042, 9], [2042, 10], [2042, 11], [2042, 12]];
const WEEKS = weeks(Date.UTC(2042, 6, 27), Date.UTC(2042, 11, 31));
const HALVES = halves(MONTHS);
const M = (id: string) => months(MONTHS).find((m) => m.id === id)!;
const SEP = { start: M("2042M09").start, end: M("2042M09").end };
export const OCT_2042 = { start: M("2042M10").start, end: M("2042M10").end };
const U12 = (m: number, d: number) => Date.UTC(2042, m - 1, d, 12);

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

interface BillSpec { paid: number[]; frequency: string; next_ms: number; amount?: number }
/** One user, one MORTGAGE CO bill paid on `paid` (stream members), synced at T. */
async function billUser(tag: string, flag: boolean, spec: BillSpec) {
  const h = await makeHarness(db, tag, mocks, { flag });
  h.ids.streams.B = `${tag}_S_B`;
  const keys = spec.paid.map((_, i) => `b${i}`);
  const amount = spec.amount ?? 100;
  h.postTxns(spec.paid.map((ms, i) => plaidTxn(h.ids, { key: keys[i], account: "chk", amount, days_ago: days_ago(ms),
    name: "MORTGAGE CO", merchant: "Mortgage Co", primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" }, T)));
  h.setRecurring({ ...scenarioRecurring(h.ids, {}, T), outflow_streams: [plaidStream(h.ids, "B", {
    account: "chk", keys, amount, description: "MORTGAGE CO", merchant: "Mortgage Co", primary: "LOAN_PAYMENTS",
    detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT", frequency: spec.frequency, status: "MATURE", is_active: true,
    first_days_ago: days_ago(spec.paid[0]), last_days_ago: days_ago(spec.paid[spec.paid.length - 1]),
    next_days: Math.round((spec.next_ms - T) / DAY),
  } as any, T)], inflow_streams: [] });
  await h.sync("link");
  return { h, uid: h.ids.userId, bill: h.ids.streams.B, doc: (i: number) => `plaid_${h.ids.txn(keys[i])}` };
}
const removeFromOct = (uid: string, bill: string) =>
  manage(ctx(), uid, [], { id: bill, action: "remove", mode: "going_forward" }, T, outflow_repo, "recurring_outflow");
const view = (uid: string, cadence: string, w: { start: number; end: number }) =>
  derive(ctx(), uid, { view_cadence: cadence, window_start_ms: w.start, window_end_ms: w.end, force: true });
const groupOf = (r: any, bill: string, pid: string) =>
  r.bills.find((b: any) => b.recurring_id === bill)?.groups.find((g: any) => g.period_id === pid);
const occ = (g: any) => (g?.occurrences ?? []).map((o: any) => [new Date(o.due_ms).toISOString().slice(0, 10), o.paid]);
const period = async (bill: string, sp: string) => (await db.collection("outflow_periods").doc(`${bill}_${sp}`).get()).data();
const runReconcile = (uid: string, bill: string) =>
  reconcile(ctx(), { recurring_id: bill, recurring_type: "outflow", user_id: uid, trace_id: "t" });
/** The derive's (expected, paid) occurrence count of the bill in one period of a view. */
const derived_counts = (r: any, bill: string, pid: string) => {
  const o = groupOf(r, bill, pid)?.occurrences ?? [];
  return [o.length, o.filter((x: any) => x.paid).length];
};
const stored_counts = (p: any) => [p?.reconciliation?.occurrencesExpected, p?.reconciliation?.occurrencesPaid];

describe("round 5 — stored periods carry what the page's matcher assigns (emulator)", () => {
  it("test 3: TWO early payments for one removed-month occurrence (Sep 29 + Sep 30 for Oct 1) → stored Sep counts == the page's", async () => {
    const { uid, bill } = await billUser("qzr5t3", false, {
      paid: [U12(8, 1), U12(9, 1), U12(9, 29), U12(9, 30)], frequency: "MONTHLY", next_ms: U12(11, 1),
    });
    await removeFromOct(uid, bill);
    const m = await view(uid, "monthly", SEP);
    expect(occ(groupOf(m, bill, "2042M09"))).toEqual([["2042-09-01", true], ["2042-09-29", true]]); // Sep 30: an extra payment
    await runReconcile(uid, bill);
    const sep = await period(bill, "2042M09");
    expect(stored_counts(sep)).toEqual(derived_counts(m, bill, "2042M09"));
    // The straddling week holds the one carried payment, as the weekly page.
    const w = await view(uid, "weekly", { start: Date.UTC(2042, 8, 28), end: Date.UTC(2042, 9, 5) - 1 });
    const wk = WEEKS.find((x) => x.start === Date.UTC(2042, 8, 28))!.id;
    expect(stored_counts(await period(bill, wk))).toEqual(derived_counts(w, bill, wk));
  }, 240000);

  it("test 4: a payment exactly 7 days from a kept AND a removed occurrence (bi-weekly, Sep 24) → the kept one, stored == page", async () => {
    // Bi-weekly, due Wednesdays Aug 20, Sep 3, Sep 17, Oct 1 (removed from Oct 1); paid Aug 20, Sep 3,
    // and Sep 24 — 7 days after Sep 17 (unpaid) and 7 days before Oct 1.
    const { uid, bill } = await billUser("qzr5t4", false, {
      paid: [U12(8, 20), U12(9, 3), U12(9, 24)], frequency: "BIWEEKLY", next_ms: U12(10, 15),
    });
    await removeFromOct(uid, bill);
    const m = await view(uid, "monthly", SEP);
    expect(occ(groupOf(m, bill, "2042M09"))).toEqual([["2042-09-03", true], ["2042-09-17", true]]);
    await runReconcile(uid, bill);
    expect(stored_counts(await period(bill, "2042M09"))).toEqual(derived_counts(m, bill, "2042M09"));
    expect((await period(bill, WEEKS.find((x) => x.start === Date.UTC(2042, 8, 28))!.id))?.carryActive ?? false).toBe(false);
  }, 240000);

  describe("test 5: an early payment never turns on a period that is off for another reason", () => {
    const W_SEP28 = () => WEEKS.find((x) => x.start === Date.UTC(2042, 8, 28))!.id;
    const ERL = { paid: [U12(8, 1), U12(9, 1), U12(9, 29)], frequency: "MONTHLY", next_ms: U12(11, 1) };

    it("a STALE (inactive) record: the straddling week stays off, nothing marked", async () => {
      const { uid, bill } = await billUser("qzr5t5a", false, ERL);
      await removeFromOct(uid, bill);
      await db.collection("outflows").doc(bill).update({ isActive: false }); // stale-marked / stopped
      await runReconcile(uid, bill);
      const wk = await period(bill, W_SEP28());
      expect([wk?.isActive, wk?.carryActive ?? false]).toEqual([false, false]);
    }, 240000);

    it("a live record whose Sep month is off for another reason: it stays off (not carryActive)", async () => {
      const { uid, bill } = await billUser("qzr5t5b", false, ERL);
      await removeFromOct(uid, bill);
      await db.collection("outflow_periods").doc(`${bill}_2042M09`).update({ isActive: false }); // e.g. stale rule / manual
      await runReconcile(uid, bill);
      const sep = await period(bill, "2042M09");
      expect([sep?.isActive, sep?.carryActive ?? false]).toEqual([false, false]);
      // …while the week the removal turned off IS turned on by the carried payment (the rule still works).
      const wk = await period(bill, W_SEP28());
      expect([wk?.isActive, wk?.carryActive]).toEqual([true, true]);
    }, 240000);
  });

  it("test 8: apply_period_suppression on a carryActive week, then reconcile → at most 2 writes, then none", async () => {
    const { uid, bill } = await billUser("qzr5t8", false, { paid: [U12(8, 1), U12(9, 1), U12(9, 29)], frequency: "MONTHLY", next_ms: U12(11, 1) });
    await removeFromOct(uid, bill);
    await runReconcile(uid, bill);
    const wk_id = WEEKS.find((x) => x.start === Date.UTC(2042, 8, 28))!.id;
    expect([(await period(bill, wk_id))?.isActive, (await period(bill, wk_id))?.carryActive]).toEqual([true, true]);
    const intervals = (await outflow_repo.get_by_id(ctx(), bill)).removal_intervals;
    const round = async () => {
      const c = startCounting();
      await outflow_repo.apply_period_suppression(ctx(), bill, intervals, uid);
      await runReconcile(uid, bill);
      const k = c.stop();
      return k.writes_by.outflow_periods ?? 0;
    };
    const first = await round();
    expect(first).toBeLessThanOrEqual(2);
    for (let i = 0; i < 3; i++) expect(await round()).toBe(0);
    expect([(await period(bill, wk_id))?.isActive, (await period(bill, wk_id))?.carryActive]).toEqual([true, true]);
  }, 240000);

  // ── Test 9 (D31): a LATE payment of the last bill before a cut-off counts, exactly once.
  const LATE = 777.77;
  /** A bill synced without its late payment, cut off, then the late payment arrives (2nd sync). */
  async function lateCase(tag: string, flag: boolean, shape: "monthly" | "weekly", action: "remove" | "pause" | "end") {
    const monthly = shape === "monthly";
    const paid = monthly ? [U12(7, 29), U12(8, 29)] : [5, 12, 19, 26].map((d) => U12(8, d)).concat([2, 9, 16, 23].map((d) => U12(9, d)));
    const late_ms = U12(10, 2); // monthly: Sep 29 + 3 days; weekly (Tuesdays): Sep 30 + 2 days (Oct 7 is 5 away)
    const due_ms = monthly ? U12(9, 29) : U12(9, 30);
    const h = await makeHarness(db, tag, mocks, { flag });
    h.ids.streams.B = `${tag}_S_B`;
    const keys = paid.map((_, i) => `b${i}`);
    const txn = (key: string, ms: number, amount: number) => plaidTxn(h.ids, { key, account: "chk", amount, days_ago: days_ago(ms),
      name: "MORTGAGE CO", merchant: "Mortgage Co", primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" }, T);
    const stream = (ks: string[], last_ms: number, amount: number) => ({ ...scenarioRecurring(h.ids, {}, T), outflow_streams: [plaidStream(h.ids, "B", {
      account: "chk", keys: ks, amount, description: "MORTGAGE CO", merchant: "Mortgage Co", primary: "LOAN_PAYMENTS",
      detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT", frequency: monthly ? "MONTHLY" : "WEEKLY", status: "MATURE", is_active: true,
      first_days_ago: days_ago(paid[0]), last_days_ago: days_ago(last_ms), next_days: Math.round(((monthly ? U12(10, 29) : U12(10, 7)) - T) / DAY),
    } as any, T)], inflow_streams: [] });
    h.postTxns(paid.map((ms, i) => txn(keys[i], ms, LATE)));
    h.setRecurring(stream(keys, paid[paid.length - 1], LATE));
    await h.sync("link");
    const uid = h.ids.userId;
    const bill = h.ids.streams.B;
    const input = action === "remove" ? { action: "remove", mode: "going_forward" }
      : action === "pause" ? { action: "pause", resume_ms: Date.UTC(2042, 10, 15) } : { action: "end" };
    // "It ended" is answered on Sep 30 (last payment Sep 23 → ends from Oct 1); the others at T.
    await manage(ctx(), uid, [], { id: bill, ...input }, action === "end" ? U12(9, 30) : T, outflow_repo, "recurring_outflow");
    const intervals = (await db.collection("outflows").doc(bill).get()).data()?.removalIntervals;
    expect(intervals.map((i: any) => i.fromMs)).toEqual([Date.UTC(2042, 9, 1)]);
    const oct_spent = async () => {
      const r = await view(uid, "monthly", OCT_2042);
      return Math.round(r.budgets.reduce((t: number, b: any) => t + b.periods.reduce((x: number, p: any) => x + (p.spent ?? 0), 0), 0) * 100) / 100;
    };
    const spent_before = await oct_spent();
    h.postTxns([txn("late", late_ms, LATE)]);
    h.setRecurring(stream([...keys, "late"], late_ms, LATE));
    await h.sync("late");
    return { uid, bill, due_ms, late_doc: `plaid_${h.ids.txn("late")}`, spent_before, oct_spent };
  }
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const paidBy = (r: any, bill: string, doc: string) =>
    r.bills.filter((b: any) => b.recurring_id === bill).flatMap((b: any) => b.groups.flatMap((g: any) =>
      g.occurrences.filter((o: any) => o.paid && o.transaction_id === doc).map((o: any) => [g.period_id, iso(o.due_ms)])));

  for (const flag of [false, true]) {
    for (const [shape, action] of [["monthly", "remove"], ["monthly", "pause"], ["weekly", "end"]] as const) {
      it(`test 9 (D31): ${flag ? "v2" : "old"} ${shape} bill, ${action === "end" ? "\"It ended\"" : action}: the Oct 2 payment pays the last bill once — every view, stored, never spend`, async () => {
        const c = await lateCase(`qzr5l${flag ? "v" : "o"}${shape[0]}${action[0]}`, flag, shape, action);
        // Engine: linked to the bill (not released) → never budget spend.
        const t = (await db.collection("transactions").doc(c.late_doc).get()).data()!;
        expect(t.splits.map((s: any) => s.outflowId)).toEqual([c.bill]);
        expect(await c.oct_spent()).toBe(c.spent_before);
        // Derive: paid exactly once, on the last occurrence before the cut-off, in each cadence.
        const W = WEEKS.find((x) => x.start === Date.UTC(2042, 8, 28))!;
        const cases: Array<[string, { start: number; end: number }, string]> = [
          ["monthly", SEP, "2042M09"], ["monthly", { start: SEP.start, end: OCT_2042.end }, "2042M09"],
          ["weekly", { start: W.start, end: W.end }, W.id], ["weekly", { start: SEP.start, end: OCT_2042.end }, W.id],
          ["bi_monthly", { start: SEP.start, end: OCT_2042.end }, "2042BM09B"],
        ];
        for (const [cad, w, pid] of cases) {
          expect({ cad, w: w.start, got: paidBy(await view(c.uid, cad, w), c.bill, c.late_doc) }).toEqual({ cad, w: w.start, got: [[pid, iso(c.due_ms)]] });
        }
        expect(paidBy(await view(c.uid, "monthly", OCT_2042), c.bill, c.late_doc)).toEqual([]); // the Oct view: counted in Sep, not here
        // Stored: the Sep month / Sep 16–30 / the straddling week hold it paid; idempotent.
        await runReconcile(c.uid, c.bill);
        const sep = await period(c.bill, "2042M09");
        expect(sep?.reconciliation?.occurrences?.find((o: any) => o.transactionId === c.late_doc)).toBeTruthy();
        expect((await period(c.bill, "2042BM09B"))?.reconciliation?.occurrences?.some((o: any) => o.transactionId === c.late_doc)).toBe(true);
        expect((await period(c.bill, W.id))?.reconciliation?.occurrences?.some((o: any) => o.transactionId === c.late_doc)).toBe(true);
        const k = startCounting();
        await runReconcile(c.uid, c.bill);
        expect(k.stop().writes_by.outflow_periods ?? 0).toBe(0);
      }, 240000);
    }
  }

  // ── Test 10 (D37 defect 1): the late rule reaches past the span ONLY for a payment in a
  // SUPPRESSED month. A LIVE bill with a past pause (Mar 2042) is no different from a never-paused
  // twin: the single-month Sep view doesn't take the Oct 2 payment (Sep 29 unpaid there).
  it("test 10 (D37): a live bill with a past pause — the single-month views equal a never-paused twin's; stored == derive", async () => {
    const spec = { paid: [U12(7, 29), U12(8, 29), U12(10, 2)], frequency: "MONTHLY", next_ms: U12(10, 29) };
    const twin = await billUser("qzr5p10t", false, spec);
    const paused = await billUser("qzr5p10p", false, spec);
    await outflow_repo.set_removal_intervals(ctx(), paused.bill, [{ from_ms: Date.UTC(2042, 2, 1), to_ms: Date.UTC(2042, 3, 1), mode: "paused" }], false, paused.uid);
    const shape = async (u: { uid: string; bill: string; doc: (i: number) => string }) => {
      const out: unknown[] = [];
      for (const [cad, w] of [["monthly", SEP], ["monthly", OCT_2042], ["monthly", { start: SEP.start, end: OCT_2042.end }]] as const) {
        const r = await view(u.uid, cad, w);
        out.push((r.bills.find((b: any) => b.recurring_id === u.bill)?.groups ?? []).map((g: any) => [g.period_id,
          g.occurrences.map((o: any) => [new Date(o.due_ms).toISOString().slice(0, 10), o.paid, o.transaction_id === u.doc(2) ? "P2" : o.transaction_id ?? null])]));
      }
      return out;
    };
    const t = await shape(twin);
    expect(t[0]).toEqual([["2042M09", [["2042-09-29", false, null]]]]);
    expect(await shape(paused)).toEqual(t);
    // Stored Sep == the Sep view (expected 1, paid 0).
    await runReconcile(paused.uid, paused.bill);
    expect(stored_counts(await period(paused.bill, "2042M09"))).toEqual(derived_counts(await view(paused.uid, "monthly", SEP), paused.bill, "2042M09"));
    expect(stored_counts(await period(paused.bill, "2042M09"))).toEqual([1, 0]);
  }, 240000);

  // ── Test 11 (D37 defect 2): the late rule applies only while the last kept occurrence is still
  // UNPAID (the matcher's judgement). A charge the matcher leaves unmatched is RELEASED — normal
  // spending, as before D31 — in the engine, the derive, stored reconcile and the bill's list.
  const XTRA = 555.55;
  async function extraCase(tag: string, flag: boolean, paid: number[], later: Array<[string, number]>) {
    const h = await makeHarness(db, tag, mocks, { flag });
    h.ids.streams.B = `${tag}_S_B`;
    const keys = paid.map((_, i) => `b${i}`);
    const txn = (key: string, ms: number) => plaidTxn(h.ids, { key, account: "chk", amount: XTRA, days_ago: days_ago(ms),
      name: "MORTGAGE CO", merchant: "Mortgage Co", primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" }, T);
    const stream = (ks: string[], last_ms: number) => ({ ...scenarioRecurring(h.ids, {}, T), outflow_streams: [plaidStream(h.ids, "B", {
      account: "chk", keys: ks, amount: XTRA, description: "MORTGAGE CO", merchant: "Mortgage Co", primary: "LOAN_PAYMENTS",
      detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT", frequency: "MONTHLY", status: "MATURE", is_active: true,
      first_days_ago: days_ago(paid[0]), last_days_ago: days_ago(last_ms), next_days: Math.round((U12(10, 29) - T) / DAY),
    } as any, T)], inflow_streams: [] });
    h.postTxns(paid.map((ms, i) => txn(keys[i], ms)));
    h.setRecurring(stream(keys, paid[paid.length - 1]));
    await h.sync("link");
    const uid = h.ids.userId;
    const bill = h.ids.streams.B;
    await removeFromOct(uid, bill);
    const spent = async (w: { start: number; end: number }) => spentOf(await view(uid, "monthly", w));
    const before = { sep: await spent(SEP), oct: await spent(OCT_2042) };
    const all = [...keys];
    for (const [key, ms] of later) { // each charge arrives in its own sync (as Plaid posts them)
      all.push(key);
      h.postTxns([txn(key, ms)]);
      h.setRecurring(stream([...all], ms));
      await h.sync(key);
    }
    return { uid, bill, before, spent, doc: (key: string) => `plaid_${h.ids.txn(key)}` };
  }
  const spentOf = (r: any) => Math.round(r.budgets.reduce((t: number, b: any) => t + b.periods.reduce((x: number, p: any) => x + (p.spent ?? 0), 0), 0) * 100) / 100;
  const iso11 = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const paidBy11 = (r: any, bill: string, doc: string) =>
    r.bills.filter((b: any) => b.recurring_id === bill).flatMap((b: any) => b.groups.flatMap((g: any) =>
      g.occurrences.filter((o: any) => o.paid && o.transaction_id === doc).map((o: any) => [g.period_id, iso11(o.due_ms)])));
  /** pays: the doc that pays Sep 29; spend: the released doc (October spending). */
  async function expectOnce(c: Awaited<ReturnType<typeof extraCase>>, pays: string, spend: string) {
    const link = async (doc: string) => ((await db.collection("transactions").doc(doc).get()).data()!.splits ?? []).map((s: any) => s.outflowId ?? null);
    // Engine: the payer is the bill's, the released charge isn't.
    expect(await link(c.doc(pays))).toEqual([c.bill]);
    expect(await link(c.doc(spend))).toEqual([null]);
    // Derive: Sep 29 paid by the payer in every view holding it; the released charge pays nothing anywhere.
    const W = WEEKS.find((x) => x.start === Date.UTC(2042, 8, 28))!;
    const views: Array<[string, { start: number; end: number }, string | null]> = [
      ["monthly", SEP, "2042M09"], ["monthly", { start: SEP.start, end: OCT_2042.end }, "2042M09"], ["monthly", OCT_2042, null],
      ["weekly", { start: W.start, end: W.end }, W.id], ["bi_monthly", { start: SEP.start, end: OCT_2042.end }, "2042BM09B"],
    ];
    for (const [cad, w, pid] of views) {
      const r = await view(c.uid, cad, w);
      expect({ cad, w: w.start, pays: paidBy11(r, c.bill, c.doc(pays)), spend: paidBy11(r, c.bill, c.doc(spend)) })
        .toEqual({ cad, w: w.start, pays: pid ? [[pid, "2042-09-29"]] : [], spend: [] });
    }
    // …and it is October spending, counted once (Sep unchanged).
    expect(await c.spent(OCT_2042)).toBe(Math.round((c.before.oct + XTRA) * 100) / 100);
    expect(await c.spent(SEP)).toBe(c.before.sep);
    // Stored: Sep holds the payer, no stored period holds the released charge.
    await runReconcile(c.uid, c.bill);
    const occ_ids = (p: any) => (p?.reconciliation?.occurrences ?? []).map((o: any) => o.transactionId ?? null);
    expect(occ_ids(await period(c.bill, "2042M09"))).toEqual([c.doc(pays)]);
    const all_periods = await db.collection("outflow_periods").where("outflowId", "==", c.bill).get();
    expect(all_periods.docs.filter((d) => occ_ids(d.data()).includes(c.doc(spend))).map((d) => d.id)).toEqual([]);
    // The bill's transaction list: the payer listed, the released charge not.
    const list = await derive_list(ctx(), c.uid, c.bill, "outflow", SEP.start, OCT_2042.end);
    const ids = list.map((t: any) => t.transaction_id);
    expect([ids.includes(c.doc(pays)), ids.includes(c.doc(spend))]).toEqual([true, false]);
  }
  let derive_list: any;
  beforeAll(() => {
    ({ derive_recurring_transactions_orchestrator: derive_list } = require("../src/functions/orchestrators/recurring/derive_recurring_transactions.orchestrator"));
  });
  for (const flag of [false, true]) {
    it(`test 11 (D37): ${flag ? "v2" : "old"} — paid on time Sep 29, an extra charge Oct 2 after removing → the Oct 2 charge is October spend`, async () => {
      const c = await extraCase(`qzr5x${flag ? "v" : "o"}a`, flag, [U12(7, 29), U12(8, 29), U12(9, 29)], [["x", U12(10, 2)]]);
      await expectOnce(c, "b2", "x");
    }, 240000);
    it(`test 11 (D37): ${flag ? "v2" : "old"} — two late payments Oct 1 + Oct 3 → the first pays Sep 29, the second is October spend`, async () => {
      const c = await extraCase(`qzr5x${flag ? "v" : "o"}b`, flag, [U12(7, 29), U12(8, 29)], [["l1", U12(10, 1)], ["l2", U12(10, 3)]]);
      await expectOnce(c, "l1", "l2");
    }, 240000);
  }
});
