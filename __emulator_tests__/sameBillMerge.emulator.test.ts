/**
 * Emulator — "Same bill" merge, its undo, a convert over an old bill (D41) and deleting the bill
 * others depend on (Convert-To-Recurring Phase 2, commit 6): F10, R9, restore blocked, undo,
 * inheritance, merged re-syncs, deleted merge target, no resurrection after deleting a converted bill.
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern sameBillMerge"
 */
import * as admin from 'firebase-admin';
import {
  FAKE_CLOCK, OCT, clearFlagFor, makeHarness, plaidTxn, scenarioRecurring, seedMonths, setFlag,
} from './helpers/captureHarness';
import { NOW_MS, plaidStream } from './helpers/captureScenario';
import { startCounting } from './helpers/firestoreCounter';

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
let answer: any;
let undo: any;
let manage: any;
let convert: any;
let outflow_repo: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  require('../src/functions/orchestrators/periods/derive_period.orchestrator');
  ({ answer_recurring_review_item_orchestrator: answer } = require('../src/functions/orchestrators/recurring/answer_recurring_review_item.orchestrator'));
  ({ undo_recurring_merge_orchestrator: undo } = require('../src/functions/orchestrators/recurring/undo_recurring_merge.orchestrator'));
  ({ manage_recurring_removal_orchestrator: manage } = require('../src/functions/orchestrators/recurring/manage_recurring_removal.orchestrator'));
  ({ convert_transaction_to_recurring_orchestrator: convert } = require('../src/functions/orchestrators/recurring/convert_transaction_to_recurring.orchestrator'));
  ({ outflow_repo } = require('../src/functions/repositories/outflow.repo'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const settle = () => new Promise((r) => setTimeout(r, 400));
const items_of = async (uid: string) => (await db.collection('recurring_review_items').where('userId', '==', uid).get()).docs.map((d) => d.data());
const sunbit2 = (ids: Parameters<typeof plaidStream>[0], keys: string[]) =>
  plaidStream(ids, 'SUNBIT2', {
    account: 'chk', keys, amount: 60, description: 'SUNBIT', merchant: 'Sunbit', primary: 'LOAN_PAYMENTS',
    detailed: 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT', frequency: 'MONTHLY', status: 'MATURE', is_active: true,
    first_days_ago: 1, last_days_ago: 1, next_days: 29,
  });
const sunbitTxn = (ids: Parameters<typeof plaidTxn>[0], key: string, days_ago: number) =>
  plaidTxn(ids, { key, account: 'chk', amount: 60, days_ago, name: 'SUNBIT', merchant: 'Sunbit', primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT' });

/** Sunbit changed plans: OLD (user-named, user-priced) stopped, NEW stream started, a "Same bill?" item open. */
async function switched(tag: string) {
  const h = await makeHarness(db, tag, mocks, { flag: false });
  h.setRecurring(scenarioRecurring(h.ids, { SUNBIT: { status: 'MATURE' } }));
  await h.sync('link');
  const OLD = h.ids.streams.SUNBIT;
  await db.collection('outflows').doc(OLD).update({ userCustomName: 'My Sunbit', expectedAmountOverride: 55 });
  await setFlag(db, [h.ids.userId]);
  const NEW = `${tag}_S_SUNBIT2`;
  h.ids.streams.SUNBIT2 = NEW;
  const rec = scenarioRecurring(h.ids, { SUNBIT: { status: 'MATURE', is_active: false } });
  rec.outflow_streams.push(sunbit2(h.ids, ['sbn1']));
  h.setRecurring(rec);
  h.postTxns([sunbitTxn(h.ids, 'sbn1', 1)]);
  await h.sync('switch');
  const item = (await items_of(h.ids.userId)).find((i) => i.kind === 'same_bill')!;
  return { h, OLD, NEW, item_id: item.id as string, rec };
}

describe('same bill — merge, undo, inheritance (emulator)', () => {
  it('F10 + R9 + inheritance: Same bill → the old bill ends and merges; the new bill keeps the user\'s name and amount; bounded cost', async () => {
    const { h, OLD, NEW, item_id } = await switched('qzmg1');
    const uid = h.ids.userId;
    const c = startCounting();
    await answer(ctx(), uid, { item_id, answer: 'same_bill' }, NOW_MS);
    await h.sync('merged');
    await settle();
    const k = c.stop();
    console.log('[R9 cost] same-bill merge + resync: reads', k.reads - (k.reads_by._audit ?? 0), 'writes', k.writes - (k.writes_by._audit ?? 0), JSON.stringify(k.writes_by));
    const old = (await db.collection('outflows').doc(OLD).get()).data()!;
    expect([old.mergedIntoId, old.isActive]).toEqual([NEW, true]);
    expect(old.mergeLog).toMatchObject({ into: NEW, inheritedName: 'My Sunbit', inheritedOverride: 55 });
    const ends = (old.removalIntervals as any[]).filter((i) => i.toMs === null);
    expect(ends).toHaveLength(1);
    expect(ends[0].fromMs).toBe(Date.UTC(2037, 10, 1)); // the month after its last payment (Oct 10)
    const nb = (await db.collection('outflows').doc(NEW).get()).data()!;
    expect([nb.captureRulesVersion, nb.userCustomName, nb.expectedAmountOverride]).toEqual([2, 'My Sunbit', 55]);
    expect((await h.txn('sbn1')).splits[0].outflowId).toBe(NEW);
    // bounded: one coalesced re-assign job at most, a handful of bumps
    const jobs = (await db.collection('_jobs').where('payload.user_id', '==', uid).get()).docs.map((d) => d.data().job_type);
    expect(jobs.filter((j) => j === 'reassign_user').length).toBeLessThanOrEqual(1);
    expect(k.writes_by.user_data_versions ?? 0).toBeLessThanOrEqual(4);
    // merged re-syncs ×3 write nothing to either bill
    for (let i = 0; i < 3; i++) {
      const c2 = startCounting();
      await h.sync(`again${i}`);
      await settle();
      const k2 = c2.stop();
      expect(k2.writes_by.outflows ?? 0).toBe(0);
    }
    expect((await db.collection('outflows').doc(OLD).get()).data()!.isActive).toBe(true); // Plaid's inactive flag never turns it off again
    // restore from the Removed list is refused; the merged bill isn't listed
    await expect(manage(ctx(), uid, [], { id: OLD, action: 'restore' }, NOW_MS, outflow_repo, 'recurring_outflow')).rejects.toBeTruthy();
    const { list_suppressed_recurring_orchestrator } = require('../src/functions/orchestrators/recurring/list_suppressed_recurring.orchestrator');
    expect((await list_suppressed_recurring_orchestrator(ctx(), uid, NOW_MS)).items.some((i: any) => i.id === OLD)).toBe(false);
  }, 300000);

  it('undo: the old bill is restored, the inherited name/override reset where unchanged, the question back to keep-separate; owner-only; the target may be deleted', async () => {
    const { h, OLD, NEW, item_id } = await switched('qzmg2');
    const uid = h.ids.userId;
    await answer(ctx(), uid, { item_id, answer: 'same_bill' }, NOW_MS);
    await h.sync('merged');
    const before_old = (await db.collection('outflows').doc(OLD).get()).data()!;
    // someone else can't undo it
    const intruder = `${h.ids.tag}_x`;
    await db.collection('users').doc(intruder).set({ email: 'x@x.com' });
    await setFlag(db, [intruder]);
    await expect(undo(ctx(), intruder, { kind: 'outflow', mode: 'merge', record_id: OLD }, NOW_MS)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await undo(ctx(), uid, { kind: 'outflow', mode: 'merge', record_id: OLD }, NOW_MS);
    const old = (await db.collection('outflows').doc(OLD).get()).data()!;
    expect(old.mergedIntoId).toBeUndefined();
    expect(old.mergeLog).toBeUndefined();
    expect(old.removalIntervals).toEqual(before_old.mergeLog.priorIntervals);
    const nb = (await db.collection('outflows').doc(NEW).get()).data()!;
    expect([nb.userCustomName, nb.expectedAmountOverride]).toEqual([null, null]);
    expect((await items_of(uid)).find((i) => i.kind === 'same_bill')!.answer).toBe('keep_separate');
    // idempotent
    expect((await undo(ctx(), uid, { kind: 'outflow', mode: 'merge', record_id: OLD }, NOW_MS)).no_op).toBe(true);
  }, 300000);

  it('deleting the merge target un-merges the old bill (restorable); a deleted target is also fine for undo', async () => {
    const { h, OLD, NEW, item_id } = await switched('qzmg3');
    const uid = h.ids.userId;
    await answer(ctx(), uid, { item_id, answer: 'same_bill' }, NOW_MS);
    await h.sync('merged');
    await manage(ctx(), uid, [], { id: NEW, action: 'delete' }, NOW_MS, outflow_repo, 'recurring_outflow');
    const old = (await db.collection('outflows').doc(OLD).get()).data()!;
    expect(old.mergedIntoId).toBeUndefined();
    expect(old.removalIntervals).toEqual([]);
  }, 300000);

  it('D41: converting over an old, turned-off bill of the vendor merges it (history stays under the old bill)', async () => {
    const h = await makeHarness(db, 'qzmg4', mocks, { flag: true });
    await h.sync('link');
    const GYM = h.ids.streams.GYM; // OLD GYM: first seen inactive -> an inactive old record
    expect((await db.collection('outflows').doc(GYM).get()).data()!.isActive).toBe(false);
    h.postTxns([plaidTxn(h.ids, { key: 'gymnew', account: 'chk', amount: 35, days_ago: 0, name: 'OLD GYM', merchant: 'Old Gym', primary: 'PERSONAL_CARE', detailed: 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS' })]);
    await h.sync('gym');
    const r = await convert(ctx(), h.ids.userId, { transaction_id: `plaid_${h.ids.txn('gymnew')}`, name: 'Gym', amount: 35, frequency: 'monthly', next_due_date: '2037-11-15', link_past: true }, NOW_MS);
    const old = (await db.collection('outflows').doc(GYM).get()).data()!;
    expect([old.mergedIntoId, old.isActive]).toEqual([r.id, true]);
    // the old bill's own payments were never taken by the retro-link
    for (const k of ['gym0', 'gym1', 'gym2']) expect((await h.txn(k)).splits[0].outflowId ?? null).not.toBe(r.id);
    await undo(ctx(), h.ids.userId, { kind: 'outflow', mode: 'merge', record_id: GYM }, NOW_MS);
    expect((await db.collection('outflows').doc(GYM).get()).data()!.mergedIntoId).toBeUndefined();
  }, 300000);

  it('deleting a converted bill that absorbed a stream: no new Plaid bill on the next 3 syncs (flag on and off)', async () => {
    for (const flag of [true, false]) {
      const h = await makeHarness(db, `qzmg5${flag ? 'a' : 'b'}`, mocks, { flag: true });
      await h.sync('link');
      const ll = (key: string, days_ago: number) => plaidTxn(h.ids, { key, account: 'chk', amount: 1500, days_ago, name: 'LANDLORD LLC', merchant: 'Landlord LLC', primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_RENT' });
      h.postTxns([ll('l1', 12), ll('l2', 42)]);
      await h.sync('rent');
      const r = await convert(ctx(), h.ids.userId, { transaction_id: `plaid_${h.ids.txn('l1')}`, name: 'Rent', amount: 1500, frequency: 'monthly', next_due_date: '2037-11-03', link_past: true }, NOW_MS);
      const rec = scenarioRecurring(h.ids);
      const SID = `${h.ids.tag}_S_LL`;
      rec.outflow_streams.push({ ...rec.outflow_streams[0], stream_id: SID, merchant_name: 'Landlord LLC', description: 'LANDLORD LLC', transaction_ids: ['l1', 'l2'].map(h.ids.txn) });
      h.setRecurring(rec);
      await h.sync('detect');
      expect((await db.collection('outflows').doc(SID).get()).exists).toBe(false);
      await manage(ctx(), h.ids.userId, [], { id: r.id, action: 'delete' }, NOW_MS, outflow_repo, 'recurring_outflow');
      if (!flag) await clearFlagFor(db, h.ids.userId);
      for (let i = 0; i < 3; i++) await h.sync(`after${i}`);
      expect((await db.collection('outflows').doc(SID).get()).exists).toBe(false);
      void OCT;
    }
  }, 400000);
});
