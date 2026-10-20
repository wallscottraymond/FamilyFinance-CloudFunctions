/**
 * Emulator — fix round 2: the preview honours the split, the resume lease (double tap during the
 * original convert / resume after the lease expires), a paused bill is live, a failed re-sync
 * rolls the answer back (item open, no pending track — a later sync makes no duplicate), the
 * delete tolerates a vanished Plaid item and always bumps, a resume with nothing left to do does
 * not bump, a purge mid-follow-up, a month switch, and a delete on a shared account.
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern fixRound2"
 */
import * as admin from 'firebase-admin';
import { FAKE_CLOCK, makeHarness, plaidTxn, scenarioRecurring, seedMonths, setFlag } from './helpers/captureHarness';
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
let convert: any; let answer: any; let manage: any; let outflow_repo: any; let preview: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  require('../src/functions/orchestrators/periods/derive_period.orchestrator');
  ({ convert_transaction_to_recurring_orchestrator: convert } = require('../src/functions/orchestrators/recurring/convert_transaction_to_recurring.orchestrator'));
  ({ answer_recurring_review_item_orchestrator: answer } = require('../src/functions/orchestrators/recurring/answer_recurring_review_item.orchestrator'));
  ({ manage_recurring_removal_orchestrator: manage } = require('../src/functions/orchestrators/recurring/manage_recurring_removal.orchestrator'));
  ({ outflow_repo } = require('../src/functions/repositories/outflow.repo'));
  ({ preview_convert_transaction_orchestrator: preview } = require('../src/functions/orchestrators/recurring/preview_convert_transaction.orchestrator'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const DAY = 86400000;
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const ago = (y: number, m: number, d: number) => Math.round((Date.UTC(2037, 9, 15) - Date.UTC(y, m - 1, d)) / DAY);
const ll = (ids: Parameters<typeof plaidTxn>[0], key: string, days_ago: number, o: Record<string, unknown> = {}) => ({
  ...plaidTxn(ids, { key, account: 'chk', amount: 1500, days_ago, name: 'LANDLORD LLC', merchant: 'Landlord LLC', primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_RENT' }), ...o,
});
const RENT = { name: 'Rent', amount: 1500, frequency: 'monthly', next_due_date: '2037-11-03', link_past: true };
const doc = (h: any, k: string) => `plaid_${h.ids.txn(k)}`;
async function rent(tag: string) {
  const h = await makeHarness(db, tag, mocks, { flag: true });
  await h.sync('link');
  h.postTxns([ll(h.ids, 'oct', ago(2037, 10, 3)), ll(h.ids, 'sep', ago(2037, 9, 3)), ll(h.ids, 'aug', ago(2037, 8, 3))]);
  await h.sync('rent');
  const r = await convert(ctx(), h.ids.userId, { transaction_id: doc(h, 'oct'), ...RENT }, NOW_MS);
  return { h, bill: r.id as string };
}


const version = async (uid: string) => ((await db.collection('user_data_versions').doc(uid).get()).data()?.version as number | undefined) ?? 0;
async function dead_convert(h: any, key: string, bill_id: string) {
  const { plan_convert } = require('../src/functions/domain/recurring/convert_plan.service');
  const { resolve_convert_facts } = require('../src/functions/resolvers/recurring/convert.resolver');
  const { convert_recurring_repo } = require('../src/functions/repositories/convert_recurring.repo');
  const r = await resolve_convert_facts(ctx(), h.ids.userId, doc(h, key), NOW_MS);
  const plan = plan_convert(r.facts, { ...RENT }, bill_id);
  await convert_recurring_repo.create_with_source_pin(ctx(), {
    direction: 'outflow', entity: { ...plan.entity, retro_txn_ids: plan.retro_plaid_ids }, user_id: h.ids.userId, run_id: 'dead', source_txn_doc_id: doc(h, key), source_split_ids: plan.source_split_ids,
  });
}
async function fresh_rent(tag: string, flag = true) {
  const h = await makeHarness(db, tag, mocks, { flag });
  await h.sync('link');
  h.postTxns([ll(h.ids, 'oct', ago(2037, 10, 3)), ll(h.ids, 'sep', ago(2037, 9, 3)), ll(h.ids, 'aug', ago(2037, 8, 3))]);
  await h.sync('rent');
  return h;
}

describe('fix round 2 (emulator)', () => {
  it('1: the preview of split B is not "already converted" once split A has a bill', async () => {
    const { h } = await rent('qzg1');
    const ref = db.collection('transactions').doc(doc(h, 'oct')); // the converted source
    const t = (await ref.get()).data()!;
    const a = { ...t.splits[0], amount: 1000 };
    const b = { ...t.splits[0], splitId: `${t.splits[0].splitId}_b`, id: `${t.splits[0].splitId}_b`, amount: 500, isDefault: false, outflowId: null };
    await ref.update({ splits: [a, b] });
    const pa = await preview(ctx(), h.ids.userId, { transaction_id: ref.id, split_id: a.splitId }, NOW_MS).catch((e: any) => e);
    const pb = await preview(ctx(), h.ids.userId, { transaction_id: ref.id, split_id: b.splitId }, NOW_MS);
    expect(pb.already_converted ?? false).toBe(false);
    expect(pa.already_converted?.id).toBeTruthy();
    expect(pa.already_converted?.unfinished).toBe(false); // finished: nothing to resume
  }, 300000);

  it('2: a double tap during the original convert does nothing (in progress); after the lease expires the next tap resumes', async () => {
    const h = await fresh_rent('qzg2');
    await dead_convert(h, 'oct', 'conv_lease');
    const tap = await convert(ctx(), h.ids.userId, { transaction_id: doc(h, 'oct'), ...RENT }, NOW_MS);
    expect(tap).toMatchObject({ id: 'conv_lease', already: true, in_progress: true });
    expect((await db.collection('outflow_periods').where('outflowId', '==', 'conv_lease').get()).size).toBe(0);
    expect((await db.collection('outflows').doc('conv_lease').get()).data()!.retroLinkedAtMs).toBeUndefined();
    // the preview tells the app it's unfinished, so a tap goes to convert (which resumes it)
    expect((await preview(ctx(), h.ids.userId, { transaction_id: doc(h, 'oct') }, NOW_MS)).already_converted).toMatchObject({ id: 'conv_lease', unfinished: true });
    await db.collection('outflows').doc('conv_lease').update({ resumeLeaseMs: 0 });
    const done = await convert(ctx(), h.ids.userId, { transaction_id: doc(h, 'oct'), ...RENT }, NOW_MS);
    expect(done.in_progress).toBeUndefined();
    expect((await db.collection('outflows').doc('conv_lease').get()).data()!.retroLinkedAtMs).toBeGreaterThan(0);
    expect((await db.collection('outflow_periods').where('outflowId', '==', 'conv_lease').get()).size).toBeGreaterThan(0);
    expect((await preview(ctx(), h.ids.userId, { transaction_id: doc(h, 'oct') }, NOW_MS)).already_converted?.unfinished).toBe(false);
  }, 300000);

  it('3 (P-a): a PAUSED bill is live — its payment cannot be converted into a second bill', async () => {
    const h = await makeHarness(db, 'qzg3', mocks, { flag: true });
    await h.sync('link');
    await manage(ctx(), h.ids.userId, [], { id: h.ids.streams.SPOT, action: 'pause', resume_ms: NOW_MS + 30 * DAY }, NOW_MS, outflow_repo, 'recurring_outflow');
    const r = await convert(ctx(), h.ids.userId, { transaction_id: doc(h, 'spot0'), name: 'Spotify', amount: 15.49, frequency: 'monthly', next_due_date: '2037-11-05', link_past: false }, NOW_MS).catch((e: any) => e);
    expect(r.code).toBe('ALREADY_TRACKED');
  }, 240000);

  it('4 (P-b): a failed re-sync rolls the answer back — item open, no pending track — and a later sync makes no duplicate bill', async () => {
    const tag = 'qzg4';
    const h = await makeHarness(db, tag, mocks, { flag: false });
    h.setRecurring(scenarioRecurring(h.ids, { SUNBIT: { status: 'MATURE' } }));
    await h.sync('link');
    await setFlag(db, [h.ids.userId]);
    h.ids.streams.SUNBIT2 = `${tag}_S_SUNBIT2`;
    const rec = scenarioRecurring(h.ids, { SUNBIT: { status: 'MATURE', is_active: false } });
    rec.outflow_streams.push(plaidStream(h.ids, 'SUNBIT2', { account: 'chk', keys: ['sbn1'], amount: 60, description: 'SUNBIT', merchant: 'Sunbit', primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT', frequency: 'MONTHLY', status: 'MATURE', is_active: true, first_days_ago: 1, last_days_ago: 1, next_days: 29 }));
    h.setRecurring(rec);
    h.postTxns([plaidTxn(h.ids, { key: 'sbn1', account: 'chk', amount: 60, days_ago: 1, name: 'SUNBIT', merchant: 'Sunbit', primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT' })]);
    await h.sync('switch');
    const item = (await db.collection('recurring_review_items').where('userId', '==', h.ids.userId).where('kind', '==', 'same_bill').get()).docs[0].data();
    const mod = require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
    const spy = jest.spyOn(mod, 'enqueue_item_sync').mockRejectedValue(new Error('queue down'));
    await expect(answer(ctx(), h.ids.userId, { item_id: item.id, answer: 'same_bill' }, NOW_MS)).rejects.toThrow();
    spy.mockRestore();
    const after = (await db.collection('recurring_review_items').doc(item.id).get()).data()!;
    expect(after.status).toBe('open');
    const state = (await db.collection('_recurring_review_state').doc(h.ids.userId).get()).data()!;
    expect(state.pendingTracks ?? []).toEqual([]);
    await h.sync('later');
    expect((await db.collection('outflows').doc(h.ids.streams.SUNBIT2).get()).exists).toBe(false); // no duplicate bill
  }, 300000);

  it('5 (P-c): deleting a converted bill tolerates a vanished Plaid item and still bumps', async () => {
    const { h, bill } = await rent('qzg5');
    await db.collection('outflows').doc(bill).update({
      absorbedStreams: [{ streamId: 'sx', state: 'absorbed', atMs: 1, txnIds: ['p1'], vendorKey: 'll properties' }], absorbedTxnIds: ['p1'],
    });
    const { plaid_item_repo } = require('../src/functions/repositories/plaid/plaid_item.repo');
    const real = await plaid_item_repo.get_active_doc_ids_by_user(ctx(), h.ids.userId);
    const spy = jest.spyOn(plaid_item_repo, 'get_active_doc_ids_by_user').mockResolvedValue([...real, 'ghost_item_doc']);
    const v0 = await version(h.ids.userId);
    await expect(manage(ctx(), h.ids.userId, [], { id: bill, action: 'delete' }, NOW_MS, outflow_repo, 'recurring_outflow')).resolves.toBeDefined();
    spy.mockRestore();
    expect(await version(h.ids.userId)).toBeGreaterThan(v0);
    const state = (await db.collection('_recurring_review_state').doc(h.ids.userId).get()).data()!;
    expect(state.suppressedTxnIds).toContain('p1');
  }, 300000);

  it('6 (P-d): a resume with nothing left to do does not bump the derive version', async () => {
    const { h, bill } = await rent('qzg6');
    await db.collection('outflows').doc(bill).update({ retroLinkedAtMs: admin.firestore.FieldValue.delete(), resumeLeaseMs: 0 });
    const v0 = await version(h.ids.userId);
    const r = await convert(ctx(), h.ids.userId, { transaction_id: doc(h, 'oct'), ...RENT }, NOW_MS);
    expect(r).toMatchObject({ id: bill, already: true });
    expect((await db.collection('outflows').doc(bill).get()).data()!.retroLinkedAtMs).toBeGreaterThan(0);
    expect(await version(h.ids.userId)).toBe(v0);
  }, 300000);

  it('purge mid-follow-up: the failed convert still bumps and leaves no marker; a resume while purging is refused; after it the next tap finishes', async () => {
    const h = await fresh_rent('qzg7');
    const uid = h.ids.userId;
    const fu = require('../src/functions/orchestrators/plaid/sync_follow_ups');
    const spy = jest.spyOn(fu, 'run_sync_follow_ups').mockRejectedValue(new Error('purge stopped it'));
    const v0 = await version(uid);
    const failed = await convert(ctx(), uid, { transaction_id: doc(h, 'oct'), ...RENT }, NOW_MS).catch((e: any) => e);
    spy.mockRestore();
    expect(failed).toBeInstanceOf(Error);
    expect(await version(uid)).toBeGreaterThan(v0);
    const bill = (await db.collection('outflows').where('ownerId', '==', uid).where('vendorKey', '==', 'landlord llc').get()).docs[0];
    expect(bill.data().retroLinkedAtMs).toBeUndefined();
    await bill.ref.update({ resumeLeaseMs: 0 });
    await db.collection('purge_status').doc(uid).set({ user_id: uid, state: 'running', initiated_by: uid });
    expect((await convert(ctx(), uid, { transaction_id: doc(h, 'oct'), ...RENT }, NOW_MS).catch((e: any) => e)).code).toBe('PURGING');
    await db.collection('purge_status').doc(uid).delete();
    const done = await convert(ctx(), uid, { transaction_id: doc(h, 'oct'), ...RENT }, NOW_MS);
    expect(done.id).toBe(bill.id);
    expect((await bill.ref.get()).data()!.retroLinkedAtMs).toBeGreaterThan(0);
  }, 300000);

  it('group account: deleting a converted bill on a shared account removes the bill (period cleanup is the delete trigger\'s)', async () => {
    const h = await fresh_rent('qzg8');
    const uid = h.ids.userId;
    const { account_repo } = require('../src/functions/repositories/account.repo');
    await account_repo.set_placement(ctx(), h.ids.chk, { group_id: 'g_del', shared_from_ms: null, shared_by: uid, shared_at_ms: 1 }, uid);
    const r = await convert(ctx(), uid, { transaction_id: doc(h, 'oct'), ...RENT }, NOW_MS);
    await manage(ctx(), uid, [], { id: r.id, action: 'delete' }, NOW_MS, outflow_repo, 'recurring_outflow');
    expect((await db.collection('outflows').doc(r.id).get()).exists).toBe(false);
  }, 300000);

  it('month switch: after the clock moves to Nov 4 a Nov 3 payment links to the converted bill', async () => {
    const { h, bill } = await rent('qzg9');
    jest.setSystemTime(Date.UTC(2037, 10, 4, 12));
    try {
      h.postTxns([ll(h.ids, 'nov', ago(2037, 11, 3))]);
      await h.sync('nov');
      expect((await h.txn('nov')).splits[0].outflowId).toBe(bill);
    } finally {
      jest.setSystemTime(NOW_MS);
    }
  }, 300000);
});
