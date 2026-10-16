/**
 * Emulator — Top-25 #4 "reviewItemRace" (review round 3 defect 1).
 *
 * The sync plans review items from the items it READ; a user's answer can land between that read
 * and the sync's write. Before the fix the sync's full `set` reverted the answer to open. Now the
 * write is guarded (transaction against the fresh doc; a changed / user-answered item is skipped):
 *   - "Not a bill" between the read and the write → stays dismissed; no open tile remains;
 *   - "Track" between them → stays tracked; the next sync creates the bill and releases its ids;
 *   - an OPEN item for a vendor the user dismissed (e.g. left by such a race) is closed.
 */
import * as admin from 'firebase-admin';
import { FAKE_CLOCK, makeHarness, plaidTxn, scenarioRecurring, seedMonths } from './helpers/captureHarness';
import { NOW_MS } from './helpers/captureScenario';

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
let answer: (ctx: any, uid: string, input: any, now: number) => Promise<any>;
let recurring_review_repo: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  ({ answer_recurring_review_item_orchestrator: answer } = require('../src/functions/orchestrators/recurring/answer_recurring_review_item.orchestrator'));
  ({ recurring_review_repo } = require('../src/functions/repositories/recurring_review.repo'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const sunbitItem = async (uid: string) =>
  (await db.collection('recurring_review_items').where('userId', '==', uid).get()).docs
    .map((d) => d.data()).find((i) => i.kind === 'suggested' && i.vendorKey === 'sunbit')!;
const sunbitTxn = (ids: Parameters<typeof plaidTxn>[0], key: string, days_ago: number) =>
  plaidTxn(ids, { key, account: 'chk', amount: 50, days_ago, name: 'SUNBIT', merchant: 'Sunbit',
    primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT' });

/** Run `between` right after the sync's review-item read (its first `get_items_by_ids`). */
function hookAfterItemRead(between: () => Promise<void>): jest.SpyInstance {
  const orig = recurring_review_repo.get_items_by_ids.bind(recurring_review_repo);
  let fired = false;
  return jest.spyOn(recurring_review_repo, 'get_items_by_ids').mockImplementation(async (...a: unknown[]) => {
    const r = await orig(...a);
    if (!fired) {
      fired = true;
      await between();
    }
    return r;
  });
}

/** Sunbit gains a payment → the sync wants to REWRITE its open item (new content). */
function sunbitChanges(h: Awaited<ReturnType<typeof makeHarness>>): void {
  h.postTxns([sunbitTxn(h.ids, 'sunbit9', 1)]);
  h.setRecurring(scenarioRecurring(h.ids, { SUNBIT: { transaction_keys: ['sunbit0', 'sunbit1', 'sunbit9'] } }));
}

describe('review item race (emulator, defect 1)', () => {
  it('"Not a bill" between the sync\'s read and write is never reverted; no open tile remains', async () => {
    const h = await makeHarness(db, 'qzrace1', mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    const item = await sunbitItem(uid);
    expect(item.status).toBe('open');
    sunbitChanges(h);
    const spy = hookAfterItemRead(async () => {
      await answer(ctx(), uid, { item_id: item.id, answer: 'not_bill' }, NOW_MS);
    });
    await h.sync('race');
    spy.mockRestore();
    let after = await sunbitItem(uid);
    expect([after.status, after.answer]).toEqual(['dismissed', 'not_bill']);
    for (let n = 0; n < 2; n++) await h.sync(`re${n}`);
    after = await sunbitItem(uid);
    expect([after.status, after.answer]).toEqual(['dismissed', 'not_bill']);
    const open = await recurring_review_repo.get_open_for_user(ctx(), uid);
    expect(open.filter((i: { vendor_key: string }) => i.vendor_key === 'sunbit')).toEqual([]);
    const state = (await db.collection('_recurring_review_state').doc(uid).get()).data()!;
    expect(state.dismissedVendorKeys).toContain('outflow:sunbit');
    expect(state.suppressedTxnIds).toEqual(expect.arrayContaining([h.ids.txn('sunbit0'), h.ids.txn('sunbit9')]));
  }, 180000);

  it('"Track" between the read and the write stays tracked; the next sync creates the bill', async () => {
    const h = await makeHarness(db, 'qzrace2', mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    const item = await sunbitItem(uid);
    sunbitChanges(h);
    const spy = hookAfterItemRead(async () => {
      await answer(ctx(), uid, { item_id: item.id, answer: 'track' }, NOW_MS);
    });
    await h.sync('race');
    spy.mockRestore();
    const after = await sunbitItem(uid);
    expect([after.status, after.answer]).toEqual(['resolved', 'track']);
    await h.sync('resync'); // the job the answer queued
    const bill = (await db.collection('outflows').doc(h.ids.streams.SUNBIT).get()).data()!;
    expect([bill.captureRulesVersion, bill.isActive]).toEqual([2, true]);
    const state = (await db.collection('_recurring_review_state').doc(uid).get()).data()!;
    expect(state.suppressedTxnIds).not.toContain(h.ids.txn('sunbit0'));
    expect(state.suppressedTxnIds).not.toContain(h.ids.txn('sunbit9'));
    expect((await sunbitItem(uid)).status).toBe('resolved');
  }, 180000);

  it('an open tile for a vendor the user already dismissed is closed by the next sync', async () => {
    const h = await makeHarness(db, 'qzrace3', mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    expect((await sunbitItem(uid)).status).toBe('open');
    // The vendor is remembered as "Not a bill" while its tile is still open (what a reverting
    // writer left behind before the fix).
    await recurring_review_repo.apply_state_change(ctx(), uid, { add_dismissed_vendor_keys: ['outflow:sunbit'] });
    await h.sync('close');
    const after = await sunbitItem(uid);
    expect([after.status, after.answer]).toEqual(['dismissed', 'not_bill']);
    await h.sync('again');
    expect((await sunbitItem(uid)).status).toBe('dismissed');
  }, 180000);
});
