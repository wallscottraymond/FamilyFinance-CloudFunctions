/**
 * Emulator — sameBillReplacement (Convert-To-Recurring D7 / D10 / X9; Phase 1 = keep separate only).
 *
 *   A. Sunbit changed plans: the OLD Sunbit stream stops and a NEW one starts → no second bill;
 *      one "Same bill?" item (about the old bill); the new payment is a normal transaction.
 *   B. Keep separate (F11) → the new stream becomes its own v2 bill; its next payment links to it
 *      only; the old record is untouched.
 *   C. Two ACTIVE streams of one vendor (Shellpoint, twice a month) → two bills, no question.
 *   D. Switch month with an every-2-weeks replacement → not expected twice (old v1 stopped bill is
 *      not shown; an old v2 bill answered "It ended" ends after its last payment).
 *   E. X9: the inactive-records load happens only when a NEW v2 stream has no candidate, and never
 *      on a steady re-sync.
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern sameBillReplacement"
 */
import * as admin from 'firebase-admin';
import {
  FAKE_CLOCK, OCT, makeHarness, paidTotal, plaidTxn, scenarioRecurring, seedMonths, setFlag,
} from './helpers/captureHarness';
import { NOW_MS, plaidStream } from './helpers/captureScenario';

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
let db: FirebaseFirestore.Firestore;
let recurring_review_repo: any;
let resolve_review_item: any;
let outflow_repo: any;
let manage: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  require('../src/functions/orchestrators/periods/derive_period.orchestrator');
  ({ recurring_review_repo } = require('../src/functions/repositories/recurring_review.repo'));
  ({ resolve_review_item } = require('../src/functions/domain/recurring/review_item.service'));
  ({ outflow_repo } = require('../src/functions/repositories/outflow.repo'));
  ({ manage_recurring_removal_orchestrator: manage } = require('../src/functions/orchestrators/recurring/manage_recurring_removal.orchestrator'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const items_of = async (uid: string) =>
  (await db.collection('recurring_review_items').where('userId', '==', uid).get()).docs.map((d) => d.data());
const sunbit2 = (ids: Parameters<typeof plaidStream>[0], keys: string[], o: Partial<Parameters<typeof plaidStream>[2]> = {}) =>
  plaidStream(ids, 'SUNBIT2', {
    account: 'chk', keys, amount: 60, description: 'SUNBIT', merchant: 'Sunbit', primary: 'LOAN_PAYMENTS',
    detailed: 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT', frequency: 'MONTHLY', status: 'MATURE', is_active: true,
    first_days_ago: 1, last_days_ago: 1, next_days: 29, ...o,
  });
const sunbitTxn = (ids: Parameters<typeof plaidTxn>[0], key: string, days_ago: number) =>
  plaidTxn(ids, { key, account: 'chk', amount: 60, days_ago, name: 'SUNBIT', merchant: 'Sunbit',
    primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT' });

describe('same bill? — replacement only (emulator)', () => {
  it('A + B: stopped Sunbit + new Sunbit → one question, no 2nd bill; keep separate → its own bill (F11)', async () => {
    const tag = 'qzsame';
    const h = await makeHarness(db, tag, mocks, { flag: false });
    h.setRecurring(scenarioRecurring(h.ids, { SUNBIT: { status: 'MATURE' } }));
    await h.sync('link'); // OLD Sunbit bill (pre-release)
    const OLD = h.ids.streams.SUNBIT;
    await setFlag(db, [h.ids.userId]);
    h.ids.streams.SUNBIT2 = `${tag}_S_SUNBIT2`;
    const rec = scenarioRecurring(h.ids, { SUNBIT: { status: 'MATURE', is_active: false } });
    rec.outflow_streams.push(sunbit2(h.ids, ['sbn1']));
    h.setRecurring(rec);
    h.postTxns([sunbitTxn(h.ids, 'sbn1', 1)]);
    const ee_before = await h.eeSpent(OCT);
    await h.sync('switch');

    expect((await db.collection('outflows').doc(h.ids.streams.SUNBIT2).get()).exists).toBe(false);
    const same = (await items_of(h.ids.userId)).filter((i) => i.kind === 'same_bill');
    expect(same.map((i) => [i.recordId, i.streamId, i.name, i.status])).toEqual([[OLD, h.ids.streams.SUNBIT2, 'Sunbit', 'open']]);
    expect((await h.txn('sbn1'))?.splits[0].outflowId ?? null).toBeNull();
    expect(await h.eeSpent(OCT)).toBe(Math.round((ee_before + 60) * 100) / 100); // not a bill yet (D10)
    // The old record keeps today's behavior (Plaid turned it off → inactive).
    expect((await db.collection('outflows').doc(OLD).get()).data()?.isActive).toBe(false);

    // B. Keep separate → next sync creates the new v2 bill; its next payment links to it only.
    const item = (await recurring_review_repo.get_items_by_ids(ctx(), [same[0].id])).get(same[0].id);
    await recurring_review_repo.upsert_items(ctx(), [resolve_review_item(item, 'keep_separate', NOW_MS)]);
    await h.sync('kept');
    const nb = (await db.collection('outflows').doc(h.ids.streams.SUNBIT2).get()).data();
    expect([nb?.captureRulesVersion, nb?.isActive]).toEqual([2, true]);
    expect((await h.txn('sbn1'))?.splits[0].outflowId).toBe(h.ids.streams.SUNBIT2); // linked once tracked
    const rec2 = scenarioRecurring(h.ids, { SUNBIT: { status: 'MATURE', is_active: false } });
    rec2.outflow_streams.push(sunbit2(h.ids, ['sbn1', 'sbn2']));
    h.setRecurring(rec2);
    h.postTxns([sunbitTxn(h.ids, 'sbn2', 0)]);
    await h.sync('f11');
    expect((await h.txn('sbn2'))?.splits[0].outflowId).toBe(h.ids.streams.SUNBIT2);
    expect((await db.collection('outflows').doc(OLD).get()).data()?.transactionIds).not.toContain(h.ids.txn('sbn2'));
    expect((await items_of(h.ids.userId)).filter((i) => i.kind === 'same_bill' && i.status === 'open')).toHaveLength(0);
  }, 180000);

  it('C: two ACTIVE streams of one vendor (twice a month) → two bills, no question', async () => {
    const tag = 'qzshell';
    const h = await makeHarness(db, tag, mocks, { flag: true });
    h.ids.streams.SHA = `${tag}_S_SHA`;
    h.ids.streams.SHB = `${tag}_S_SHB`;
    const rec = scenarioRecurring(h.ids);
    for (const [k, d] of [['SHA', 15], ['SHB', 1]] as const) {
      rec.outflow_streams.push(plaidStream(h.ids, k, {
        account: 'chk', keys: [], amount: 428, description: 'SHELLPOINT MTG', merchant: 'Shellpoint', primary: 'LOAN_PAYMENTS',
        detailed: 'LOAN_PAYMENTS_MORTGAGE_PAYMENT', frequency: 'MONTHLY', status: 'MATURE', is_active: true,
        first_days_ago: 300 + d, last_days_ago: d, next_days: 30 - d,
      }));
    }
    h.setRecurring(rec);
    await h.sync('link');
    for (const k of ['SHA', 'SHB']) {
      const o = (await db.collection('outflows').doc(h.ids.streams[k]).get()).data();
      expect([k, o?.captureRulesVersion, o?.isActive]).toEqual([k, 2, true]);
    }
    expect((await items_of(h.ids.userId)).filter((i) => i.kind === 'same_bill')).toHaveLength(0);
  }, 120000);

  it('D: switch month with an every-2-weeks replacement is not expected twice', async () => {
    const tag = 'qzswitch';
    const h = await makeHarness(db, tag, mocks, { flag: true });
    h.ids.streams.OLDB = `${tag}_S_OLDB`;
    h.ids.streams.NEWB = `${tag}_S_NEWB`;
    const biweekly = (k: string, o: Partial<Parameters<typeof plaidStream>[2]>) => plaidStream(h.ids, k, {
      account: 'chk', keys: [], amount: 200, description: 'BUMPER AUTO', merchant: 'Bumper', primary: 'LOAN_PAYMENTS',
      detailed: 'LOAN_PAYMENTS_CAR_PAYMENT', frequency: 'BIWEEKLY', status: 'MATURE', is_active: true,
      first_days_ago: 200, last_days_ago: 25, next_days: null, ...o,
    });
    const rec = scenarioRecurring(h.ids);
    rec.outflow_streams.push(biweekly('OLDB', {})); // v2 at link (flag on)
    h.setRecurring(rec);
    await h.sync('link');
    const OLDB = h.ids.streams.OLDB;
    expect((await db.collection('outflows').doc(OLDB).get()).data()?.captureRulesVersion).toBe(2);
    // The old biweekly stops (last paid Sep 20); a new biweekly starts Oct 4.
    const rec2 = scenarioRecurring(h.ids);
    rec2.outflow_streams.push(biweekly('OLDB', { is_active: false }));
    rec2.outflow_streams.push(biweekly('NEWB', { first_days_ago: 11, last_days_ago: 11, next_days: 3, amount: 215 }));
    h.setRecurring(rec2);
    await h.sync('switch');
    const q = (await items_of(h.ids.userId)).filter((i) => i.kind === 'same_bill');
    expect(q.map((i) => i.recordId)).toEqual([OLDB]);
    // Keep separate + the old one "It ended" (its own Still a bill? answer).
    const same = (await recurring_review_repo.get_items_by_ids(ctx(), [q[0].id])).get(q[0].id);
    await recurring_review_repo.upsert_items(ctx(), [resolve_review_item(same, 'keep_separate', NOW_MS)]);
    await manage(ctx(), h.ids.userId, [], { id: OLDB, action: 'end' }, NOW_MS, outflow_repo, 'recurring_outflow');
    await h.sync('kept');
    const oct = await h.derive(OCT);
    const old_b = oct.bills.find((b: { recurring_id: string }) => b.recurring_id === OLDB);
    const new_b = oct.bills.find((b: { recurring_id: string }) => b.recurring_id === h.ids.streams.NEWB);
    expect(old_b?.groups ?? []).toEqual([]); // ended after its Sep payment → nothing in October
    expect((new_b?.groups ?? []).reduce((n: number, g: { count_in_period: number }) => n + g.count_in_period, 0)).toBeGreaterThan(0);
    expect(paidTotal(old_b)).toBe(0);
  }, 180000);

  it('E (X9): inactive records load only for a NEW v2 stream without a candidate; never on a steady re-sync', async () => {
    const h = await makeHarness(db, 'qzlazy', mocks, { flag: true });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const capture_resolver = require('../src/functions/resolvers/recurring/recurring_capture.resolver');
    const spy_o = jest.spyOn(capture_resolver, 'resolve_inactive_capture_records'); // the planner's lazy load
    await h.sync('link'); // new mature streams with no candidate → one lazy load
    const first = spy_o.mock.calls.length;
    expect(first).toBe(1);
    await h.sync('again'); // steady: every stream has a record now → no load
    await h.sync('again2');
    expect(spy_o.mock.calls.length).toBe(first);
    spy_o.mockRestore();
  }, 120000);
});
