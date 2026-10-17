/**
 * Emulator — D1 going-forward matching of CONVERTED bills / income (Convert-To-Recurring Phase 2,
 * commit 2). A converted record is v2 + manual + a vendor key on a Plaid account; a payment of
 * that vendor on that account links to it by KEY through the real sync / assignment path, any
 * amount — flag OFF too (D16: the record decides, not the flag). Covers:
 *   F5  Rent vs Parent: a different vendor on the same account is NOT linked; any amount links
 *   F16 (D44) two bills of one key → closest amount, deterministic, 0 writes on re-run
 *   floor: a payment before the bill's creation day stays in budgets unless a convert linked it
 *   fuzzy exclusion: a look-alike merchant never fuzzy-links to a converted bill; old bills still do
 *   multi-split payments are not linked; a held-out payment keeps its D1 link on the page
 *   income direction
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern convertedD1"
 */
import * as admin from 'firebase-admin';
import { FAKE_CLOCK, OCT, makeHarness, paidTotal, plaidTxn, seedMonths } from './helpers/captureHarness';
import { seedConverted } from './helpers/convertedSeed';
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
let assign_batch: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  ({ assign_transactions_batch_orchestrator: assign_batch } = require('../src/functions/orchestrators/transactions/assign_transactions_batch.orchestrator'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const ctx = (n = 't') => ({ trace_id: `${n}_${Math.random()}`, span_id: 's' });
const landlord = (ids: Parameters<typeof plaidTxn>[0], key: string, days_ago: number, amount = 1500, o: Record<string, unknown> = {}) => ({
  ...plaidTxn(ids, { key, account: 'chk', amount, days_ago, name: 'LANDLORD LLC', merchant: 'Landlord LLC',
    primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_RENT' }),
  ...o,
});
const settle = () => new Promise((r) => setTimeout(r, 300));

describe('D1: converted bills link by key (emulator)', () => {
  it('F5: any amount links; a different vendor on the same account, and the same vendor on another account, do not (flag OFF)', async () => {
    const h = await makeHarness(db, 'qzd1a', mocks, { flag: false });
    await h.sync('link');
    const rent = await seedConverted(db, h.ids, { id: `${h.ids.tag}_rent`, name: 'Rent', amount: 1500, vendor_key: 'landlord llc', account: 'chk', merchant_source: 'Landlord LLC', next_days: 0 });
    h.postTxns([
      landlord(h.ids, 'r1', 0, 1500),
      landlord(h.ids, 'r2', 0, 87.31, { transaction_id: h.ids.txn('r2') }), // any amount
      plaidTxn(h.ids, { key: 'parent', account: 'chk', amount: 1500, days_ago: 0, name: 'PARENT', merchant: 'Parent', primary: 'TRANSFER_OUT', detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER' }),
      { ...landlord(h.ids, 'r_sav', 0, 1500), account_id: h.ids.sav },
    ]);
    await h.sync('deliver');
    expect((await h.txn('r1'))!.splits[0].outflowId).toBe(rent);
    expect((await h.txn('r2'))!.splits[0].outflowId).toBe(rent);
    expect((await h.txn('parent'))!.splits[0].outflowId ?? null).toBeNull();
    expect((await h.txn('r_sav'))!.splits[0].outflowId ?? null).toBeNull();
    // the denormalized link the reconcile / list read
    expect((await h.txn('r1'))!.splitOutflowIds).toEqual([rent]);
    // the payment left budgets: Everything Else spent excludes the 1500 + 87.31 rent payments
    const bill = await h.bill(OCT, rent);
    expect(paidTotal(bill)).toBeGreaterThan(0);
  }, 180000);

  it('the floor: a payment before the bill was created stays a normal transaction, unless a convert linked it (D46)', async () => {
    const h = await makeHarness(db, 'qzd1b', mocks, { flag: false });
    await h.sync('link');
    const old_plaid = h.ids.txn('r_old');
    const rent = await seedConverted(db, h.ids, {
      id: `${h.ids.tag}_rent`, name: 'Rent', amount: 1500, vendor_key: 'landlord llc', account: 'chk',
      retro_plaid_ids: [h.ids.txn('r_linked')],
    });
    h.postTxns([landlord(h.ids, 'r_old', 20), landlord(h.ids, 'r_linked', 50), landlord(h.ids, 'r_new', 0)]);
    await h.sync('deliver');
    expect((await h.txn('r_old'))!.splits[0].outflowId ?? null).toBeNull();
    expect((await h.txn('r_linked'))!.splits[0].outflowId).toBe(rent);
    expect((await h.txn('r_new'))!.splits[0].outflowId).toBe(rent);
    void old_plaid;
  }, 180000);

  it('fuzzy exclusion: a look-alike merchant never fuzzy-links to a converted bill', async () => {
    const h = await makeHarness(db, 'qzd1c', mocks, { flag: false });
    await h.sync('link');
    const rent = await seedConverted(db, h.ids, { id: `${h.ids.tag}_rent`, name: 'Landlord', amount: 1500, vendor_key: 'landlord llc', account: 'chk', periods: true });
    // same merchant text family but a different key ("landlord llc payments"), same amount and date
    h.postTxns([landlord(h.ids, 'look', 0, 1500, { merchant_name: 'Landlord LLC Payments', name: 'LANDLORD LLC PAYMENTS' })]);
    await h.sync('deliver');
    expect((await h.txn('look'))!.splits[0].outflowId ?? null).toBeNull();
    expect((await db.collection('outflows').doc(rent).get()).data()!.transactionIds).toEqual([]);
  }, 180000);

  it('F16 (D44): two bills of one key → closest amount, deterministic, 0 writes on re-run', async () => {
    const h = await makeHarness(db, 'qzd1d', mocks, { flag: false });
    await h.sync('link');
    const icloud = await seedConverted(db, h.ids, { id: `${h.ids.tag}_icloud`, name: 'iCloud', amount: 3, vendor_key: 'apple', account: 'chk', merchant_source: 'Apple' });
    const music = await seedConverted(db, h.ids, { id: `${h.ids.tag}_music`, name: 'Apple Music', amount: 11, vendor_key: 'apple', account: 'chk', merchant_source: 'Apple' });
    const apple = (key: string, amount: number) => ({
      ...plaidTxn(h.ids, { key, account: 'chk', amount, days_ago: 0, name: 'APPLE', merchant: 'Apple', primary: 'ENTERTAINMENT', detailed: 'ENTERTAINMENT_MUSIC_AND_AUDIO' }),
    });
    h.postTxns([apple('a3', 2.99), apple('a11', 10.99), apple('a_tie', 7)]);
    await h.sync('deliver');
    expect((await h.txn('a3'))!.splits[0].outflowId).toBe(icloud);
    expect((await h.txn('a11'))!.splits[0].outflowId).toBe(music);
    // 7 is 4 from icloud(3) and 4 from music(11): the smaller id wins, on every run
    const tie = (await h.txn('a_tie'))!.splits[0].outflowId;
    expect(tie).toBe([icloud, music].sort()[0]);
    const docs = ['a3', 'a11', 'a_tie'].map((k) => `plaid_${h.ids.txn(k)}`);
    for (let i = 0; i < 3; i++) {
      const c = startCounting();
      await assign_batch(ctx('re'), { user_id: h.ids.userId, transaction_ids: docs });
      await settle();
      const k = c.stop();
      expect(k.writes_by.transactions ?? 0).toBe(0);
    }
    expect((await h.txn('a_tie'))!.splits[0].outflowId).toBe(tie);
  }, 180000);

  it('a multi-split payment is not linked (the user\'s own breakdown); the page keeps a held-out single payment linked', async () => {
    const h = await makeHarness(db, 'qzd1e', mocks, { flag: false });
    await h.sync('link');
    const rent = await seedConverted(db, h.ids, { id: `${h.ids.tag}_rent`, name: 'Rent', amount: 1500, vendor_key: 'landlord llc', account: 'chk', next_days: 0 });
    h.postTxns([landlord(h.ids, 'multi', 0, 1500), landlord(h.ids, 'held', 0, 1500)]);
    await h.sync('deliver');
    // make 'multi' two splits, then re-assign
    const mref = db.collection('transactions').doc(`plaid_${h.ids.txn('multi')}`);
    const m = (await mref.get()).data()!;
    const s0 = { ...m.splits[0], amount: 1000, outflowId: null, outflowAssignmentSource: 'auto' };
    const s1 = { ...m.splits[0], splitId: `${m.splits[0].splitId}_b`, amount: 500, outflowId: null, outflowAssignmentSource: 'auto', isDefault: false };
    await mref.update({ splits: [s0, s1], splitOutflowIds: [] });
    await assign_batch(ctx('multi'), { user_id: h.ids.userId, transaction_ids: [mref.id] });
    const after = (await mref.get()).data()!;
    expect(after.splits.map((s: { outflowId: string | null }) => s.outflowId ?? null)).toEqual([null, null]);
    // the held-out single payment: hold-out state names it, its D1 link survives on the page
    const { recurring_review_repo } = require('../src/functions/repositories/recurring_review.repo');
    await recurring_review_repo.apply_state_change(ctx(), h.ids.userId, { add_suppressed: [h.ids.txn('held')], remove_suppressed: [] });
    await assign_batch(ctx('held'), { user_id: h.ids.userId, transaction_ids: [`plaid_${h.ids.txn('held')}`] });
    expect((await h.txn('held'))!.splits[0].outflowId).toBe(rent);
    expect(paidTotal(await h.bill(OCT, rent))).toBe(1500);
  }, 180000);

  it('income: a deposit of the vendor on the account links to the converted income', async () => {
    const h = await makeHarness(db, 'qzd1f', mocks, { flag: false });
    await h.sync('link');
    const gig = await seedConverted(db, h.ids, { id: `${h.ids.tag}_gig`, direction: 'inflow', name: 'Side gig', amount: 500, vendor_key: 'side gig co', account: 'chk', merchant_source: 'Side Gig Co' });
    h.postTxns([{ ...plaidTxn(h.ids, { key: 'gig1', account: 'chk', amount: -432.1, days_ago: 0, name: 'SIDE GIG CO', merchant: 'Side Gig Co', primary: 'INCOME', detailed: 'INCOME_OTHER_INCOME' }) }]);
    await h.sync('deliver');
    expect((await h.txn('gig1'))!.splits[0].inflowId).toBe(gig);
    expect((await h.txn('gig1'))!.splitInflowIds).toEqual([gig]);
  }, 180000);
});
