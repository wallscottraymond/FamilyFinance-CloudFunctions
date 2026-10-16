/**
 * Emulator — Top-25 #5 "crossItemVendorSuggestion" (review round 3 defect 2).
 *
 * Suggested tiles are keyed per vendor but were built from ONE stream, so:
 *   - two Plaid items, each with an EARLY_DETECTION stream of the same vendor, overwrote the tile
 *     on every sync (stream id / account / payments flip-flopped);
 *   - a reordered stream list inside one item did the same.
 * Now: 3 alternating syncs of each item after round 1 → at most 1 item write; a shuffled stream
 * order → 0 writes.
 */
import * as admin from 'firebase-admin';
import { FAKE_CLOCK, makeHarness, scenarioRecurring, seedMonths } from './helpers/captureHarness';
import { plaidStream } from './helpers/captureScenario';
import { seedSecondItem } from './helpers/secondItem';
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

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: FirebaseFirestore.Firestore;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());

const mocks = { mockSync, mockRecurring };
const sunbitStream = (ids: any, name: string, account: string, keys: string[]) => {
  ids.streams[name] = `${ids.tag}_S_${name}`;
  return plaidStream(ids, name, {
    account: account as 'chk', keys, amount: 50, description: 'SUNBIT', merchant: 'Sunbit', primary: 'LOAN_PAYMENTS',
    detailed: 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT', frequency: 'MONTHLY', status: 'EARLY_DETECTION', is_active: true,
    first_days_ago: 35, last_days_ago: 5, next_days: 25,
  });
};
const sunbitItems = async (uid: string) =>
  (await db.collection('recurring_review_items').where('userId', '==', uid).get()).docs
    .map((d) => d.data()).filter((i) => i.vendorKey === 'sunbit');

describe('one suggested tile per vendor, built deterministically (emulator, defect 2)', () => {
  it('two Plaid items with an early stream of the same vendor: ≤1 item write over 3 alternating syncs each', async () => {
    const h = await makeHarness(db, 'qzxitem', mocks, { flag: true });
    await h.sync('linkA');
    const b = await seedSecondItem(db, h.ids, mocks);
    (h.ids as any).chk2 = b.chk;
    const recB = { ...scenarioRecurring(h.ids), outflow_streams: [sunbitStream(h.ids, 'SUNB2', 'chk2', ['b_sun0', 'b_sun1', 'b_sun2'])], inflow_streams: [] };
    await b.sync('linkB', recB);
    expect((await sunbitItems(h.ids.userId))).toHaveLength(1); // one tile for the vendor
    const c = startCounting();
    for (let n = 0; n < 3; n++) {
      await h.sync(`a${n}`);
      await b.sync(`b${n}`, recB);
    }
    const k = c.stop();
    expect(k.writes_by.recurring_review_items ?? 0).toBeLessThanOrEqual(1);
    const items = await sunbitItems(h.ids.userId);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('open');
    // Both items' payments stay held out of fuzzy matching.
    const state = (await db.collection('_recurring_review_state').doc(h.ids.userId).get()).data()!;
    expect(state.suppressedTxnIds).toEqual(expect.arrayContaining([h.ids.txn('sunbit0'), h.ids.txn('b_sun0')]));
  }, 240000);

  it('a reordered stream list inside one item → 0 item writes', async () => {
    const h = await makeHarness(db, 'qzxshuf', mocks, { flag: true });
    const base = scenarioRecurring(h.ids);
    const extra = sunbitStream(h.ids, 'SUNB3', 'chk', ['x_sun0', 'x_sun1']);
    const order1 = { ...base, outflow_streams: [...base.outflow_streams, extra] };
    const order2 = { ...base, outflow_streams: [extra, ...[...base.outflow_streams].reverse()] };
    h.setRecurring(order1);
    await h.sync('link');
    const before = await sunbitItems(h.ids.userId);
    expect(before).toHaveLength(1);
    const c = startCounting();
    for (let n = 0; n < 4; n++) {
      h.setRecurring(n % 2 ? order1 : order2);
      await h.sync(`s${n}`);
    }
    const k = c.stop();
    expect(k.writes_by.recurring_review_items ?? 0).toBe(0);
    expect((await sunbitItems(h.ids.userId))[0].streamId).toBe(before[0].streamId);
  }, 240000);
});
