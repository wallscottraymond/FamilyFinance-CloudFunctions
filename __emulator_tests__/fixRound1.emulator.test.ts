/**
 * Emulator — fix round 1 (fresh reviewer of 4c11ad0..10b097e): A late arrivals link, B absorbed ids
 * obey the floors, C the delete memory survives with no other v2 record and the flag off, D resume
 * finishes the D41 merge + the review question, E a second split converts on its own, F D41 undo
 * restores isActive, G a removed bill doesn't claim a payment, P1 a failed re-sync rolls the merge
 * back, P7 retro finds transactions without a stored vendorKey and pages past 600 rows, P9 delete
 * remembers the absorbed stream's own vendor, flag on→off keeps linking.
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern fixRound1"
 */
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { FAKE_CLOCK, clearFlagFor, makeHarness, plaidTxn, scenarioRecurring, seedMonths, setFlag } from './helpers/captureHarness';
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
let convert: any; let answer: any; let undo: any; let manage: any; let outflow_repo: any; let pin: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  require('../src/functions/orchestrators/periods/derive_period.orchestrator');
  ({ convert_transaction_to_recurring_orchestrator: convert } = require('../src/functions/orchestrators/recurring/convert_transaction_to_recurring.orchestrator'));
  ({ answer_recurring_review_item_orchestrator: answer } = require('../src/functions/orchestrators/recurring/answer_recurring_review_item.orchestrator'));
  ({ undo_recurring_merge_orchestrator: undo } = require('../src/functions/orchestrators/recurring/undo_recurring_merge.orchestrator'));
  ({ manage_recurring_removal_orchestrator: manage } = require('../src/functions/orchestrators/recurring/manage_recurring_removal.orchestrator'));
  ({ outflow_repo } = require('../src/functions/repositories/outflow.repo'));
  ({ assign_split_to_inflow_orchestrator: pin } = require('../src/functions/orchestrators/recurring/assign_split_to_inflow.orchestrator'));
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
const stream_rec = (h: any, keys: string[], id: string, merchant = 'Landlord LLC') => {
  const rec = scenarioRecurring(h.ids);
  rec.outflow_streams.push({ ...rec.outflow_streams[0], stream_id: id, merchant_name: merchant, description: merchant.toUpperCase(), transaction_ids: keys.map(h.ids.txn) });
  return rec;
};

describe('fix round 1 (emulator)', () => {
  it('A: a payment that arrives AFTER the convert — dated a few days before it, or tomorrow — links', async () => {
    const { h, bill } = await rent('qzfx1');
    h.postTxns([ll(h.ids, 'late', 3), ll(h.ids, 'tomorrow', -1), ll(h.ids, 'ancient', 40)]);
    await h.sync('arrive');
    expect((await h.txn('late')).splits[0].outflowId).toBe(bill);
    expect((await h.txn('tomorrow')).splits[0].outflowId).toBe(bill);
    expect((await h.txn('ancient')).splits[0].outflowId ?? null).toBeNull(); // history stays in budgets
  }, 240000);

  it('B: an absorbed stream\'s OLD payments stay in budgets; recent ones link; the 24-month history is not rewritten', async () => {
    const { h, bill } = await rent('qzfx2');
    h.postTxns([ll(h.ids, 'old1', 400, { name: 'LL PMT 1', merchant_name: null }), ll(h.ids, 'old2', 700, { name: 'LL PMT 2', merchant_name: null }), ll(h.ids, 'new1', 0, { name: 'LL PMT 3', merchant_name: null })]);
    h.setRecurring(stream_rec(h, ['oct', 'sep', 'old1', 'old2', 'new1'], `${h.ids.tag}_S_LL`));
    await h.sync('detect');
    expect((await h.txn('new1')).splits[0].outflowId).toBe(bill);
    for (const k of ['old1', 'old2']) expect((await h.txn(k)).splits[0].outflowId ?? null).toBeNull();
  }, 240000);

  it('P9: deleting a converted bill remembers the absorbed stream\'s OWN vendor as well as its own', async () => {
    const { h, bill } = await rent('qzfx3');
    await db.collection('outflows').doc(bill).update({
      absorbedStreams: [{ streamId: 'sx', state: 'absorbed', atMs: 1, txnIds: ['p1'], vendorKey: 'll properties' }], absorbedTxnIds: ['p1'],
    });
    await manage(ctx(), h.ids.userId, [], { id: bill, action: 'delete' }, NOW_MS, outflow_repo, 'recurring_outflow');
    const state = (await db.collection('_recurring_review_state').doc(h.ids.userId).get()).data()!;
    expect([...state.dismissedVendorKeys].sort()).toEqual(['outflow:landlord llc', 'outflow:ll properties']);
    expect(state.suppressedTxnIds).toContain('p1');
  }, 300000);

  it('C (strict): converted + absorbed + deleted, no other v2 record, flag off → the stream never returns (3 syncs)', async () => {
    const { h, bill } = await rent('qzfx4');
    const SID = `${h.ids.tag}_S_LL`;
    h.setRecurring(stream_rec(h, ['oct', 'sep'], SID));
    await h.sync('detect');
    expect((await db.collection('outflows').doc(SID).get()).exists).toBe(false);
    await manage(ctx(), h.ids.userId, [], { id: bill, action: 'delete' }, NOW_MS, outflow_repo, 'recurring_outflow');
    expect((await db.collection('plaid_items').doc(h.ids.itemDocId).get()).data()!.reviewMemory).toBe(true);
    for (const coll of ['outflows', 'inflows']) {
      for (const d of (await db.collection(coll).where('ownerId', '==', h.ids.userId).get()).docs) {
        if (d.data().captureRulesVersion === 2) await d.ref.delete();
      }
    }
    await clearFlagFor(db, h.ids.userId);
    for (let i = 0; i < 3; i++) await h.sync(`after${i}`);
    expect((await db.collection('outflows').doc(SID).get()).exists).toBe(false);
  }, 300000);

  it('D + F: a convert that died after the bill finishes the D41 merge and the review question on the next tap; undo restores the old bill\'s inactive flag', async () => {
    const h = await makeHarness(db, 'qzfx5', mocks, { flag: true });
    await h.sync('link');
    const GYM = h.ids.streams.GYM;
    h.postTxns([plaidTxn(h.ids, { key: 'gymnew', account: 'chk', amount: 35, days_ago: 0, name: 'OLD GYM', merchant: 'Old Gym', primary: 'PERSONAL_CARE', detailed: 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS' })]);
    await h.sync('gym');
    const { plan_convert } = require('../src/functions/domain/recurring/convert_plan.service');
    const { resolve_convert_facts } = require('../src/functions/resolvers/recurring/convert.resolver');
    const { convert_recurring_repo } = require('../src/functions/repositories/convert_recurring.repo');
    const req = { name: 'Gym', amount: 35, frequency: 'monthly', next_due_date: '2037-11-15', link_past: true };
    const r = await resolve_convert_facts(ctx(), h.ids.userId, doc(h, 'gymnew'), NOW_MS);
    const plan = plan_convert(r.facts, req, 'conv_dead2');
    await convert_recurring_repo.create_with_source_pin(ctx(), { direction: 'outflow', entity: { ...plan.entity, retro_txn_ids: plan.retro_plaid_ids }, user_id: h.ids.userId, run_id: 'dead', source_txn_doc_id: doc(h, 'gymnew'), source_split_ids: plan.source_split_ids });
    expect((await db.collection('outflows').doc(GYM).get()).data()!.mergedIntoId).toBeUndefined(); // died before the merge
    await convert(ctx(), h.ids.userId, { transaction_id: doc(h, 'gymnew'), ...req }, NOW_MS);
    const old = (await db.collection('outflows').doc(GYM).get()).data()!;
    expect([old.mergedIntoId, old.isActive]).toEqual(['conv_dead2', true]);
    const done = (await db.collection('outflows').doc('conv_dead2').get()).data()!;
    expect(done.retroLinkedAtMs).toBeGreaterThan(0); // stamped last
    await undo(ctx(), h.ids.userId, { kind: 'outflow', mode: 'merge', record_id: GYM }, NOW_MS);
    expect((await db.collection('outflows').doc(GYM).get()).data()!.isActive).toBe(false); // F
  }, 300000);

  it('E: after splitting a transaction, split B converts on its own (split A already has a bill)', async () => {
    const { h, bill } = await rent('qzfx6');
    const ref = db.collection('transactions').doc(doc(h, 'sep'));
    const t = (await ref.get()).data()!;
    const a = { ...t.splits[0], amount: 1000 };
    const b = { ...t.splits[0], splitId: `${t.splits[0].splitId}_b`, id: `${t.splits[0].splitId}_b`, amount: 500, isDefault: false, outflowId: null };
    await ref.update({ splits: [a, b] });
    const first = await convert(ctx(), h.ids.userId, { transaction_id: ref.id, split_id: a.splitId, ...RENT, amount: 1000, link_past: false }, NOW_MS).catch((e: any) => e);
    void first; void bill;
    const second = await convert(ctx(), h.ids.userId, { transaction_id: ref.id, split_id: b.splitId, name: 'Rent extras', amount: 500, frequency: 'monthly', next_due_date: '2037-11-03', link_past: false }, NOW_MS);
    expect(second.already).toBe(false);
    const by = Object.fromEntries(((await ref.get()).data()!.splits as any[]).map((s) => [s.splitId, s]));
    expect(by[b.splitId].outflowId).toBe(second.id);
  }, 300000);

  it('G: a payment of a Plaid bill the user REMOVED can be converted', async () => {
    const h = await makeHarness(db, 'qzfx7', mocks, { flag: true });
    await h.sync('link');
    await manage(ctx(), h.ids.userId, [], { id: h.ids.streams.SPOT, action: 'remove', mode: 'all' }, NOW_MS, outflow_repo, 'recurring_outflow');
    const r = await convert(ctx(), h.ids.userId, { transaction_id: doc(h, 'spot0'), name: 'Spotify', amount: 15.49, frequency: 'monthly', next_due_date: '2037-11-05', link_past: false }, NOW_MS)
      .catch((e: any) => e);
    expect(r.code).not.toBe('ALREADY_TRACKED');
  }, 240000);

  it('P1: when the re-sync can\'t be queued, the same-bill merge is rolled back', async () => {
    const tag = 'qzfx8';
    const h = await makeHarness(db, tag, mocks, { flag: false });
    h.setRecurring(scenarioRecurring(h.ids, { SUNBIT: { status: 'MATURE' } }));
    await h.sync('link');
    const OLD = h.ids.streams.SUNBIT;
    await setFlag(db, [h.ids.userId]);
    h.ids.streams.SUNBIT2 = `${tag}_S_SUNBIT2`;
    const rec = scenarioRecurring(h.ids, { SUNBIT: { status: 'MATURE', is_active: false } });
    rec.outflow_streams.push(plaidStream(h.ids, 'SUNBIT2', { account: 'chk', keys: ['sbn1'], amount: 60, description: 'SUNBIT', merchant: 'Sunbit', primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT', frequency: 'MONTHLY', status: 'MATURE', is_active: true, first_days_ago: 1, last_days_ago: 1, next_days: 29 }));
    h.setRecurring(rec);
    h.postTxns([plaidTxn(h.ids, { key: 'sbn1', account: 'chk', amount: 60, days_ago: 1, name: 'SUNBIT', merchant: 'Sunbit', primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT' })]);
    await h.sync('switch');
    const item = (await db.collection('recurring_review_items').where('userId', '==', h.ids.userId).where('kind', '==', 'same_bill').get()).docs[0].data();
    const before = (await db.collection('outflows').doc(OLD).get()).data()!;
    const mod = require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
    const spy = jest.spyOn(mod, 'enqueue_item_sync').mockRejectedValue(new Error('queue down'));
    await expect(answer(ctx(), h.ids.userId, { item_id: item.id, answer: 'same_bill' }, NOW_MS)).rejects.toThrow();
    spy.mockRestore();
    const after = (await db.collection('outflows').doc(OLD).get()).data()!;
    expect(after.mergedIntoId).toBeUndefined();
    expect(after.removalIntervals).toEqual(before.removalIntervals);
  }, 300000);

  it('P7: retro finds transactions with NO stored vendorKey (computed as the engine does) and the repo pages past 600 rows', async () => {
    const { h } = await rent('qzfx9'); // converts with keys present, just to reuse the harness
    void h;
    const h2 = await makeHarness(db, 'qzfx10', mocks, { flag: true });
    await h2.sync('link');
    h2.postTxns([ll(h2.ids, 'a', ago(2037, 10, 3)), ll(h2.ids, 'b', ago(2037, 9, 3)), ll(h2.ids, 'c', ago(2037, 8, 3))]);
    await h2.sync('rent');
    for (const k of ['a', 'b', 'c']) await db.collection('transactions').doc(doc(h2, k)).update({ vendorKey: admin.firestore.FieldValue.delete() });
    const r = await convert(ctx(), h2.ids.userId, { transaction_id: doc(h2, 'a'), ...RENT }, NOW_MS);
    expect(r.linked_past_count).toBe(2);
    // paging: 650 raw rows of one vendor come back whole
    const uid = `${h2.ids.tag}_pg`;
    for (let i = 0; i < 650; i += 400) {
      const batch = db.batch();
      for (let j = i; j < Math.min(650, i + 400); j++) {
        batch.set(db.collection('transactions').doc(`pg_${uid}_${j}`), { userId: uid, ownerId: uid, isActive: true, vendorKey: 'pager', transactionDate: Timestamp.fromMillis(NOW_MS - j * 3600_000) });
      }
      await batch.commit();
    }
    const { transaction_repo } = require('../src/functions/repositories/transaction.repo');
    expect((await transaction_repo.get_by_vendor_key(ctx(), uid, 'pager', NOW_MS - 400 * DAY)).length).toBe(650);
  }, 300000);

  it('flag on → off: the converted bill keeps linking (D16); a concurrent resume runs once', async () => {
    const { h, bill } = await rent('qzfx11');
    await clearFlagFor(db, h.ids.userId);
    h.postTxns([ll(h.ids, 'after', 0, { amount: 77.7 })]);
    await h.sync('off');
    expect((await h.txn('after')).splits[0].outflowId).toBe(bill);
    const repo = outflow_repo;
    expect(await repo.claim_resume(ctx(), bill, NOW_MS)).toBe(true);
    expect(await repo.claim_resume(ctx(), bill, NOW_MS)).toBe(false); // the lease is held
  }, 240000);

  it('group: an income pin inside a shared account\'s view succeeds', async () => {
    const h = await makeHarness(db, 'qzfx12', mocks, { flag: true });
    await h.sync('link');
    const { account_repo } = require('../src/functions/repositories/account.repo');
    const { seedConverted } = require('./helpers/convertedSeed');
    await account_repo.set_placement(ctx(), h.ids.chk, { group_id: 'g_x', shared_from_ms: null, shared_by: h.ids.userId, shared_at_ms: 1 }, h.ids.userId);
    const gig = await seedConverted(db, h.ids, { id: `${h.ids.tag}_gig`, direction: 'inflow', name: 'Gig', amount: 5, vendor_key: 'gig', account: 'chk' });
    const t = await h.txn('pay0');
    await pin(ctx(), h.ids.userId, { transaction_id: doc(h, 'pay0'), split_id: t.splits[0].splitId, inflow_id: gig });
    expect((await h.txn('pay0')).splits[0].inflowId).toBe(gig);
  }, 240000);
});
