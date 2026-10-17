/**
 * Emulator — fix round 4: a resume writes ONLY the missing periods (stored ones keep their
 * removal / hidden state), a repeating failure gives up (CONVERT_FAILED) instead of looping, the
 * "converted" answer leaves the item open while the bill is still being finished, and a Plaid
 * sync's full-doc write can't restore stale convert-lifecycle markers.
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern fixRound4"
 */
import * as admin from 'firebase-admin';
import { FAKE_CLOCK, makeHarness, plaidTxn, seedMonths } from './helpers/captureHarness';
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
let convert: any; let answer: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  require('../src/functions/orchestrators/periods/derive_period.orchestrator');
  ({ convert_transaction_to_recurring_orchestrator: convert } = require('../src/functions/orchestrators/recurring/convert_transaction_to_recurring.orchestrator'));
  ({ answer_recurring_review_item_orchestrator: answer } = require('../src/functions/orchestrators/recurring/answer_recurring_review_item.orchestrator'));
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
async function fresh_rent(tag: string) {
  const h = await makeHarness(db, tag, mocks, { flag: true });
  await h.sync('link');
  h.postTxns([ll(h.ids, 'oct', ago(2037, 10, 3)), ll(h.ids, 'sep', ago(2037, 9, 3)), ll(h.ids, 'aug', ago(2037, 8, 3))]);
  await h.sync('rent');
  return h;
}
const bill_of = async (uid: string) => (await db.collection('outflows').where('ownerId', '==', uid).where('vendorKey', '==', 'landlord llc').get()).docs;
const gen = () => require('../src/functions/orchestrators/outflows/generate_outflow_periods.orchestrator');
const failing_after_writing = () => {
  const real = gen().generate_outflow_periods_orchestrator;
  return jest.spyOn(gen(), 'generate_outflow_periods_orchestrator').mockImplementation(async (c: any) => ({ ...(await real(c)), success: false, errors: ['partway'] }));
};

describe('fix round 4 (emulator)', () => {
  it('D1: a resume creates only the MISSING periods — removed / hidden stored periods are untouched', async () => {
    const h = await fresh_rent('qzi1');
    const spy = failing_after_writing();
    const first = await convert(ctx(), h.ids.userId, { transaction_id: doc(h, 'oct'), ...RENT }, NOW_MS);
    spy.mockRestore();
    expect(first.in_progress).toBe(true);
    const [b] = await bill_of(h.ids.userId);
    const periods = (await db.collection('outflow_periods').where('outflowId', '==', b.id).get()).docs;
    expect(periods.length).toBeGreaterThan(3);
    const [removed, hidden, gone] = periods;
    await removed.ref.update({ isActive: false }); // "this period only" removal / an ended pause
    await hidden.ref.update({ isHidden: true });
    const gone_id = gone.id;
    await gone.ref.delete(); // a period that really is missing
    await convert(ctx(), h.ids.userId, { transaction_id: doc(h, 'oct'), ...RENT }, NOW_MS);
    expect((await removed.ref.get()).data()!.isActive).toBe(false);
    expect((await hidden.ref.get()).data()!.isHidden).toBe(true);
    expect((await db.collection('outflow_periods').doc(gone_id).get()).exists).toBe(true); // regenerated
    expect((await b.ref.get()).data()!.retroLinkedAtMs).toBeGreaterThan(0);
  }, 300000);

  it('P2: a failure that repeats gives up with CONVERT_FAILED instead of looping; no more work or bumps', async () => {
    const h = await fresh_rent('qzi2');
    const spy = jest.spyOn(gen(), 'generate_outflow_periods_orchestrator').mockResolvedValue({ success: false, periods_created: 0, errors: ['boom'], trace_id: 't' });
    const req = { transaction_id: doc(h, 'oct'), ...RENT };
    expect((await convert(ctx(), h.ids.userId, req, NOW_MS)).in_progress).toBe(true); // attempt 1
    expect((await convert(ctx(), h.ids.userId, req, NOW_MS)).in_progress).toBe(true); // 2
    expect((await convert(ctx(), h.ids.userId, req, NOW_MS)).in_progress).toBe(true); // 3
    const v = async () => ((await db.collection('user_data_versions').doc(h.ids.userId).get()).data()?.version as number | undefined) ?? 0;
    const v0 = await v();
    const calls = spy.mock.calls.length;
    const fourth = await convert(ctx(), h.ids.userId, req, NOW_MS).catch((e: any) => e);
    expect(fourth.code).toBe('CONVERT_FAILED');
    expect(spy.mock.calls.length).toBe(calls);
    expect(await v()).toBe(v0);
    spy.mockRestore();
  }, 300000);

  it('P3: answering "track" while the bill is still being finished leaves the item OPEN and reports in_progress', async () => {
    const h = await makeHarness(db, 'qzi3', mocks, { flag: true });
    const t = (key: string, days_ago: number) => plaidTxn(h.ids, { key, account: 'chk', amount: 40, days_ago, name: 'CITY WATER', merchant: 'City Water', primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_WATER' });
    h.postTxns([6, 37, 67].map((d, i) => t(`water${i}`, d)));
    await h.sync('link');
    const item = (await db.collection('recurring_review_items').where('userId', '==', h.ids.userId).get()).docs.map((d) => d.data()).find((i) => i.name === 'City Water')!;
    const spy = jest.spyOn(gen(), 'generate_outflow_periods_orchestrator').mockResolvedValue({ success: false, periods_created: 0, errors: ['boom'], trace_id: 't' });
    const r = await answer(ctx(), h.ids.userId, { item_id: item.id, answer: 'track', frequency: 'monthly' }, NOW_MS);
    spy.mockRestore();
    expect(r).toMatchObject({ status: 'open', in_progress: true });
    expect((await db.collection('recurring_review_items').doc(item.id).get()).data()!.status).toBe('open');
  }, 300000);

  it('P4: a stale full-doc write by a sync cannot restore old convert-lifecycle markers', async () => {
    const h = await fresh_rent('qzi4');
    await convert(ctx(), h.ids.userId, { transaction_id: doc(h, 'oct'), ...RENT }, NOW_MS);
    const [b] = await bill_of(h.ids.userId);
    const stored = (await b.ref.get()).data()!;
    const { without_lifecycle_markers } = require('../src/functions/repositories/convert_doc_fields');
    // what a sync read EARLIER (markers as they were) …
    const stale = { ...stored, resumeLeaseMs: 1, followUpsDoneAtMs: 1, convertAttempts: 1, retroLinkedAtMs: 1, absorbedTxnIds: ['x'] };
    // … the markers get newer values …
    await b.ref.update({ resumeLeaseMs: 999, followUpsDoneAtMs: 999, convertAttempts: 2, retroLinkedAtMs: 999 });
    // … then the sync writes its stale doc the way save_batch does
    const { data, merge } = without_lifecycle_markers(stale, stale);
    expect(merge).toBe(true);
    await b.ref.set(data, { merge: true });
    const after = (await b.ref.get()).data()!;
    expect([after.resumeLeaseMs, after.followUpsDoneAtMs, after.convertAttempts, after.retroLinkedAtMs]).toEqual([999, 999, 2, 999]);
    expect(after.absorbedTxnIds).toEqual(['x']); // everything else is the sync's
    // a doc with no markers is written byte-identically (flag-off identity)
    expect(without_lifecycle_markers({ a: 1 }, { a: 1 })).toEqual({ data: { a: 1 }, merge: false });
  }, 300000);
});
