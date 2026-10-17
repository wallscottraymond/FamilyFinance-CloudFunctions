/**
 * Emulator — review round 5: stored periods carry EXACTLY what the period page's matcher assigns
 * across a removal / "It ended" / pause cut-off (defects 3–5, D31, tests 3, 4, 5, 8, 9).
 *
 * Clock Oct 15 2042 (Oct 1 2042 is a Wednesday: the week Sun Sep 28 – Sat Oct 4 straddles the
 * cut-off). Each case is one user with one bill; the stored periods are reconciled (the job the
 * recurring-update trigger runs) and compared with the derived period page.
 */
import * as admin from 'firebase-admin';
import { FAKE_CLOCK, makeHarness, plaidTxn, scenarioRecurring } from './helpers/captureHarness';
import { plaidStream } from './helpers/captureScenario';
import { halves, months, seedPeriods, weeks } from './helpers/sourcePeriods';

const mockSync = jest.fn();
const mockRecurring = jest.fn();
jest.mock('../src/functions/integrations/plaid', () => {
  const actual = jest.requireActual('../src/functions/integrations/plaid');
  return {
    ...actual,
    sync_transactions: (...a: unknown[]) => mockSync(...a),
    fetch_recurring_transactions: (...a: unknown[]) => mockRecurring(...a),
    fetch_plaid_accounts: async () => ({ accounts: [], item_id: 'x', request_id: 'r' }),
    safe_fetch_liabilities: async () => null,
  };
});
jest.mock('../src/utils/encryption', () => {
  const actual = jest.requireActual('../src/utils/encryption');
  return { ...actual, decryptAccessToken: () => 'decrypted-token' };
});

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
const DAY = 86400000;
const T = Date.UTC(2042, 9, 15, 12);
const MONTHS: Array<[number, number]> = [[2042, 7], [2042, 8], [2042, 9], [2042, 10], [2042, 11], [2042, 12]];
const WEEKS = weeks(Date.UTC(2042, 6, 27), Date.UTC(2042, 11, 31));
const HALVES = halves(MONTHS);
const M = (id: string) => months(MONTHS).find((m) => m.id === id)!;
const SEP = { start: M('2042M09').start, end: M('2042M09').end };
export const OCT_2042 = { start: M('2042M10').start, end: M('2042M10').end };
const U12 = (m: number, d: number) => Date.UTC(2042, m - 1, d, 12);

let db: FirebaseFirestore.Firestore;
let manage: any;
let outflow_repo: any;
let derive: any;
let reconcile: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers({ ...FAKE_CLOCK, now: T });
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  ({ derive_period_orchestrator: derive } = require('../src/functions/orchestrators/periods/derive_period.orchestrator'));
  ({ manage_recurring_removal_orchestrator: manage } = require('../src/functions/orchestrators/recurring/manage_recurring_removal.orchestrator'));
  ({ outflow_repo } = require('../src/functions/repositories'));
  ({ reconcile_recurring_periods_orchestrator: reconcile } = require('../src/functions/orchestrators/recurring/reconcile_recurring_periods.orchestrator'));
  db = admin.firestore();
  await seedPeriods(db, [...months(MONTHS), ...WEEKS, ...HALVES]);
}, 60000);
afterAll(() => jest.useRealTimers());

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const days_ago = (ms: number) => Math.round((T - ms) / DAY);

interface BillSpec { paid: number[]; frequency: string; next_ms: number; amount?: number }
/** One user, one MORTGAGE CO bill paid on `paid` (stream members), synced at T. */
async function billUser(tag: string, flag: boolean, spec: BillSpec) {
  const h = await makeHarness(db, tag, mocks, { flag });
  h.ids.streams.B = `${tag}_S_B`;
  const keys = spec.paid.map((_, i) => `b${i}`);
  const amount = spec.amount ?? 100;
  h.postTxns(spec.paid.map((ms, i) => plaidTxn(h.ids, { key: keys[i], account: 'chk', amount, days_ago: days_ago(ms),
    name: 'MORTGAGE CO', merchant: 'Mortgage Co', primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_MORTGAGE_PAYMENT' }, T)));
  h.setRecurring({ ...scenarioRecurring(h.ids, {}, T), outflow_streams: [plaidStream(h.ids, 'B', {
    account: 'chk', keys, amount, description: 'MORTGAGE CO', merchant: 'Mortgage Co', primary: 'LOAN_PAYMENTS',
    detailed: 'LOAN_PAYMENTS_MORTGAGE_PAYMENT', frequency: spec.frequency, status: 'MATURE', is_active: true,
    first_days_ago: days_ago(spec.paid[0]), last_days_ago: days_ago(spec.paid[spec.paid.length - 1]),
    next_days: Math.round((spec.next_ms - T) / DAY),
  } as any, T)], inflow_streams: [] });
  await h.sync('link');
  return { h, uid: h.ids.userId, bill: h.ids.streams.B, doc: (i: number) => `plaid_${h.ids.txn(keys[i])}` };
}
const removeFromOct = (uid: string, bill: string) =>
  manage(ctx(), uid, [], { id: bill, action: 'remove', mode: 'going_forward' }, T, outflow_repo, 'recurring_outflow');
const view = (uid: string, cadence: string, w: { start: number; end: number }) =>
  derive(ctx(), uid, { view_cadence: cadence, window_start_ms: w.start, window_end_ms: w.end, force: true });
const groupOf = (r: any, bill: string, pid: string) =>
  r.bills.find((b: any) => b.recurring_id === bill)?.groups.find((g: any) => g.period_id === pid);
const occ = (g: any) => (g?.occurrences ?? []).map((o: any) => [new Date(o.due_ms).toISOString().slice(0, 10), o.paid]);
const period = async (bill: string, sp: string) => (await db.collection('outflow_periods').doc(`${bill}_${sp}`).get()).data();
const runReconcile = (uid: string, bill: string) =>
  reconcile(ctx(), { recurring_id: bill, recurring_type: 'outflow', user_id: uid, trace_id: 't' });
/** The derive's (expected, paid) occurrence count of the bill in one period of a view. */
const derived_counts = (r: any, bill: string, pid: string) => {
  const o = groupOf(r, bill, pid)?.occurrences ?? [];
  return [o.length, o.filter((x: any) => x.paid).length];
};
const stored_counts = (p: any) => [p?.reconciliation?.occurrencesExpected, p?.reconciliation?.occurrencesPaid];

describe('round 5 — stored periods carry what the page\'s matcher assigns (emulator)', () => {
  it('test 3: TWO early payments for one removed-month occurrence (Sep 29 + Sep 30 for Oct 1) → stored Sep counts == the page\'s', async () => {
    const { uid, bill } = await billUser('qzr5t3', false, {
      paid: [U12(8, 1), U12(9, 1), U12(9, 29), U12(9, 30)], frequency: 'MONTHLY', next_ms: U12(11, 1),
    });
    await removeFromOct(uid, bill);
    const m = await view(uid, 'monthly', SEP);
    expect(occ(groupOf(m, bill, '2042M09'))).toEqual([['2042-09-01', true], ['2042-09-29', true]]); // Sep 30: an extra payment
    await runReconcile(uid, bill);
    const sep = await period(bill, '2042M09');
    expect(stored_counts(sep)).toEqual(derived_counts(m, bill, '2042M09'));
    // The straddling week holds the one carried payment, as the weekly page.
    const w = await view(uid, 'weekly', { start: Date.UTC(2042, 8, 28), end: Date.UTC(2042, 9, 5) - 1 });
    const wk = WEEKS.find((x) => x.start === Date.UTC(2042, 8, 28))!.id;
    expect(stored_counts(await period(bill, wk))).toEqual(derived_counts(w, bill, wk));
  }, 240000);

  it('test 4: a payment exactly 7 days from a kept AND a removed occurrence (bi-weekly, Sep 24) → the kept one, stored == page', async () => {
    // Bi-weekly, due Wednesdays Aug 20, Sep 3, Sep 17, Oct 1 (removed from Oct 1); paid Aug 20, Sep 3,
    // and Sep 24 — 7 days after Sep 17 (unpaid) and 7 days before Oct 1.
    const { uid, bill } = await billUser('qzr5t4', false, {
      paid: [U12(8, 20), U12(9, 3), U12(9, 24)], frequency: 'BIWEEKLY', next_ms: U12(10, 15),
    });
    await removeFromOct(uid, bill);
    const m = await view(uid, 'monthly', SEP);
    expect(occ(groupOf(m, bill, '2042M09'))).toEqual([['2042-09-03', true], ['2042-09-17', true]]);
    await runReconcile(uid, bill);
    expect(stored_counts(await period(bill, '2042M09'))).toEqual(derived_counts(m, bill, '2042M09'));
    expect((await period(bill, WEEKS.find((x) => x.start === Date.UTC(2042, 8, 28))!.id))?.carryActive ?? false).toBe(false);
  }, 240000);

  describe('test 5: an early payment never turns on a period that is off for another reason', () => {
    const W_SEP28 = () => WEEKS.find((x) => x.start === Date.UTC(2042, 8, 28))!.id;
    const ERL = { paid: [U12(8, 1), U12(9, 1), U12(9, 29)], frequency: 'MONTHLY', next_ms: U12(11, 1) };

    it('a STALE (inactive) record: the straddling week stays off, nothing marked', async () => {
      const { uid, bill } = await billUser('qzr5t5a', false, ERL);
      await removeFromOct(uid, bill);
      await db.collection('outflows').doc(bill).update({ isActive: false }); // stale-marked / stopped
      await runReconcile(uid, bill);
      const wk = await period(bill, W_SEP28());
      expect([wk?.isActive, wk?.carryActive ?? false]).toEqual([false, false]);
    }, 240000);

    it('a live record whose Sep month is off for another reason: it stays off (not carryActive)', async () => {
      const { uid, bill } = await billUser('qzr5t5b', false, ERL);
      await removeFromOct(uid, bill);
      await db.collection('outflow_periods').doc(`${bill}_2042M09`).update({ isActive: false }); // e.g. stale rule / manual
      await runReconcile(uid, bill);
      const sep = await period(bill, '2042M09');
      expect([sep?.isActive, sep?.carryActive ?? false]).toEqual([false, false]);
      // …while the week the removal turned off IS turned on by the carried payment (the rule still works).
      const wk = await period(bill, W_SEP28());
      expect([wk?.isActive, wk?.carryActive]).toEqual([true, true]);
    }, 240000);
  });
});
