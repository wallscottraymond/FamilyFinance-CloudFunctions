/**
 * Emulator — tracking a detector suggestion (Convert-To-Recurring Phase 2, commit 7): F5.
 * "Track this bill" on a possible bill the detector found (no Plaid stream) converts its latest
 * payment: the bill exists on that account, the past payments link (one per occurrence), the item
 * closes `converted` (not `track`), a payment of ANY amount from the same vendor links next, a
 * different merchant on the same account does not; answering again is a no-op; income works too.
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern detectorTrack"
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
let answer: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  require('../src/functions/orchestrators/periods/derive_period.orchestrator');
  ({ answer_recurring_review_item_orchestrator: answer } = require('../src/functions/orchestrators/recurring/answer_recurring_review_item.orchestrator'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const items_of = async (uid: string) => (await db.collection('recurring_review_items').where('userId', '==', uid).get()).docs.map((d) => d.data());

describe('detector suggestion → Track (F5, emulator)', () => {
  it('Track converts the latest payment; past payments link; ANY amount links next; another merchant does not; again is a no-op', async () => {
    const h = await makeHarness(db, 'qzdt1', mocks, { flag: true });
    const t = (key: string, days_ago: number, amount: number, merchant: string, detailed = 'RENT_AND_UTILITIES_WATER', primary = 'RENT_AND_UTILITIES') =>
      plaidTxn(h.ids, { key, account: 'chk', amount, days_ago, name: merchant.toUpperCase(), merchant, primary, detailed });
    h.postTxns([6, 37, 67].map((d, i) => t(`water${i}`, d, 40 + i, 'City Water')));
    await h.sync('link');
    const item = (await items_of(h.ids.userId)).find((i) => i.name === 'City Water')!;
    expect([item.source, item.status]).toEqual(['detector', 'open']);
    const r = await answer(ctx(), h.ids.userId, { item_id: item.id, answer: 'track', frequency: 'monthly' }, NOW_MS);
    expect(r).toMatchObject({ status: 'resolved', answer: 'converted' });
    const bills = (await db.collection('outflows').where('ownerId', '==', h.ids.userId).where('vendorKey', '==', 'city water').get()).docs;
    expect(bills).toHaveLength(1);
    const bill = bills[0];
    expect(bill.data()).toMatchObject({ accountId: h.ids.chk, source: 'manual', captureRulesVersion: 2, convertedFromTxnId: `plaid_${h.ids.txn('water0')}` });
    for (const k of ['water0', 'water1', 'water2']) expect(((await h.txn(k)).splits[0] as any).outflowId).toBe(bill.id);
    const closed = (await items_of(h.ids.userId)).find((i) => i.name === 'City Water')!;
    expect([closed.status, closed.answer]).toEqual(['resolved', 'converted']);
    // again: a no-op, still one bill
    expect((await answer(ctx(), h.ids.userId, { item_id: item.id, answer: 'track', frequency: 'monthly' }, NOW_MS)).no_op).toBe(true);
    expect((await db.collection('outflows').where('ownerId', '==', h.ids.userId).where('vendorKey', '==', 'city water').get()).size).toBe(1);
    // next payments: any amount links; a different merchant on the same account does not
    h.postTxns([t('w_new', 0, 913.5, 'City Water'), t('other', 0, 41, 'City Sewer Fees')]);
    await h.sync('next');
    expect(((await h.txn('w_new')).splits[0] as any).outflowId).toBe(bill.id);
    expect(((await h.txn('other')).splits[0] as any).outflowId ?? null).toBeNull();
    // the vendor is covered: the detector doesn't suggest it again
    expect((await items_of(h.ids.userId)).filter((i) => i.name === 'City Water' && i.status === 'open')).toHaveLength(0);
  }, 240000);

  it('income: Track on a detected income converts it to an inflow', async () => {
    const h = await makeHarness(db, 'qzdt2', mocks, { flag: true });
    h.postTxns([4, 18, 32].map((d, i) => plaidTxn(h.ids, { key: `gig${i}`, account: 'chk', amount: -300, days_ago: d, name: 'SIDE GIG LLC', merchant: 'Side Gig LLC', primary: 'INCOME', detailed: 'INCOME_OTHER_INCOME' })));
    await h.sync('link');
    const item = (await items_of(h.ids.userId)).find((i) => i.name === 'Side Gig LLC')!;
    const r = await answer(ctx(), h.ids.userId, { item_id: item.id, answer: 'track', frequency: 'biweekly' }, NOW_MS);
    expect(r.answer).toBe('converted');
    const inc = (await db.collection('inflows').where('ownerId', '==', h.ids.userId).where('vendorKey', '==', 'side gig llc').get()).docs;
    expect(inc).toHaveLength(1);
    expect(((await h.txn('gig0')).splits[0] as any)).toMatchObject({ inflowId: inc[0].id, inflowAssignmentSource: 'manual' });
  }, 240000);
});
