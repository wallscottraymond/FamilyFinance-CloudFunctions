/**
 * Emulator — possibleBillDetector (Convert-To-Recurring D11 / D17 / X12 / X14 / X17 / X19).
 *
 *   - rides the classifier's scan on the first link: City Water (utilities) + a side-gig income are
 *     suggested; daily / weekly coffee, card "income" and anything in a stream are not; a vendor
 *     with a Plaid suggestion keeps ONE tile (X14); R11: no dismissed vendor written
 *   - R2 / R3: 10 syncs + 20 enqueues in a day → ONE job doc `detect:{uid}:{day}`; a throttled
 *     job run costs one state read (+ the purge guard) — full cost measured
 *   - a DELAYED detector job is processed by the queue sweep (both job maps register it)
 *   - R1: 5,050-transaction user, full run — reads bounded (transactions once, cap logged)
 *   - R13: flag off → never enqueued; detector reads nothing
 *   - purge with open items + state + a pending detector job → all gone, nothing re-created
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern possibleBillDetector"
 */
import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { FAKE_CLOCK, makeHarness, plaidTxn, seedMonths } from './helpers/captureHarness';
import { NOW_MS } from './helpers/captureScenario';
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
    remove_item: async () => ({ success: true, already_removed: false, request_id: 'x' }),
  };
});
jest.mock('../src/utils/encryption', () => {
  const actual = jest.requireActual('../src/utils/encryption');
  return { ...actual, decryptAccessToken: () => 'decrypted-token' };
});

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
let db: FirebaseFirestore.Firestore;
let jobq: any;
let det: any;
let job: any;
let purge: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  require('../src/functions/orchestrators/periods/derive_period.orchestrator');
  jobq = require('../src/functions/infrastructure/job_queue');
  det = require('../src/functions/orchestrators/recurring/detect_possible_recurring.orchestrator');
  job = require('../src/functions/orchestrators/recurring/detect_possible_recurring.job');
  ({ purge_user_data_orchestrator: purge } = require('../src/functions/orchestrators/users/purge_user_data.orchestrator'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const DAY = 86400000;
const items_of = async (uid: string) =>
  (await db.collection('recurring_review_items').where('userId', '==', uid).get()).docs.map((d) => d.data());

/** Extra transactions the detector should (and shouldn't) find. */
function extras(ids: Parameters<typeof plaidTxn>[0]) {
  const t = (key: string, account: 'chk' | 'sav' | 'card', amount: number, days_ago: number, merchant: string, primary: string, detailed: string) =>
    plaidTxn(ids, { key, account, amount, days_ago, name: merchant.toUpperCase(), merchant, primary, detailed });
  return [
    ...[6, 37, 67].map((d, i) => t(`water${i}`, 'chk', 40 + i, d, 'City Water', 'RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_WATER')),
    ...[4, 18, 32].map((d, i) => t(`gig${i}`, 'chk', -300, d, 'Side Gig LLC', 'INCOME', 'INCOME_OTHER_INCOME')),
    ...[4, 18, 32].map((d, i) => t(`rewards${i}`, 'card', -25, d, 'Card Rewards', 'INCOME', 'INCOME_OTHER_INCOME')),
    ...[1, 2, 3, 4, 5, 6, 7].map((d, i) => t(`coffee${i}`, 'chk', 4, d, 'Corner Coffee', 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE')),
    ...[2, 9, 16, 23].map((d, i) => t(`monday${i}`, 'chk', 6, d, 'Monday Coffee', 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE')),
    // More Sunbit payments OUTSIDE Plaid's (EARLY) stream: the detector must not add a 2nd tile.
    ...[65, 95, 125].map((d, i) => t(`sbx${i}`, 'chk', 50, d, 'Sunbit', 'LOAN_PAYMENTS', 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT')),
  ];
}

describe('possible-bill detector (emulator)', () => {
  it('finds City Water + side gig; no coffee / card income / stream payments; one tile per vendor; R11', async () => {
    const h = await makeHarness(db, 'qzdet', mocks, { flag: true });
    h.postTxns(extras(h.ids));
    await h.sync('link');
    const items = await items_of(h.ids.userId);
    const by = (name: string) => items.filter((i) => i.name === name);
    expect(by('City Water').map((i) => [i.source, i.direction, i.frequency, i.status])).toEqual([['detector', 'outflow', 'monthly', 'open']]);
    expect(by('Side Gig LLC').map((i) => [i.source, i.direction, i.frequency])).toEqual([['detector', 'inflow', 'biweekly']]);
    for (const n of ['Corner Coffee', 'Monday Coffee', 'Card Rewards', 'Spotify', 'Acme', 'Capital One']) expect([n, by(n).length]).toEqual([n, 0]);
    expect(by('Sunbit').map((i) => i.source)).toEqual(['plaid']); // X14: one tile, Plaid's
    expect(by('Avant').map((i) => i.source)).toEqual(['plaid']);
    const state = (await db.collection('_recurring_review_state').doc(h.ids.userId).get()).data()!;
    expect(state.detectorLastRunDay).toBe('2037-10-15');
    expect(state.dismissedVendorKeys).toEqual([]); // R11: the detector never writes "Not a bill"
  }, 180000);

  it('R2 / R3: 10 syncs + 20 enqueues in a day → one job doc; a throttled run costs 1 state read (+purge guard)', async () => {
    const h = await makeHarness(db, 'qzthr', mocks, { flag: true });
    await h.sync('link'); // the detector ran inline today
    const job_id = det.detector_job_id(h.ids.userId, NOW_MS);
    const creates: number[] = [];
    for (let n = 0; n < 10; n++) {
      h.postTxns([plaidTxn(h.ids, { key: `more${n}`, account: 'chk', amount: 9 + n, days_ago: 0, name: 'SHOP', merchant: 'Shop',
        primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_OTHER' })]);
      const c = startCounting();
      await h.sync(`s${n}`);
      creates.push(c.stop().writes_by._jobs ?? 0);
    }
    for (let n = 0; n < 20; n++) await det.enqueue_detector_job(ctx(), h.ids.userId, NOW_MS + n * 30000); // a webhook burst
    const jobs = await db.collection('_jobs').where('payload.user_id', '==', h.ids.userId).where('job_type', '==', 'detect_possible_recurring').get();
    expect(jobs.docs.map((d) => d.id)).toEqual([job_id]);
    expect(jobs.docs[0].data().scheduled_for.toMillis()).toBeGreaterThan(NOW_MS); // delayed (coalescing)
    // Throttled run: full cost.
    const c = startCounting();
    const r = await job.run_detect_possible_recurring_job(ctx(), { user_id: h.ids.userId });
    const k = c.stop();
    expect(r).toEqual({ ran: false, reason: 'already_today' });
    console.log('[R2] create attempts per sync:', JSON.stringify(creates), 'throttled job run:', JSON.stringify({ reads: k.reads, writes: k.writes, reads_by: k.reads_by }));
    expect(k.writes).toBe(0);
    expect(k.reads_by._recurring_review_state).toBe(1);
    expect(k.reads).toBeLessThanOrEqual(2); // state + purge guard (flag is cached)
  }, 180000);

  it('a DELAYED detector job is processed by the sweep (registered in both job maps)', async () => {
    for (const f of ['../src/functions/entry/triggers/on_job_created.trigger.ts', '../src/functions/entry/scheduled/process_job_queue.scheduled.ts']) {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
      expect(src).toMatch(/detect_possible_recurring: async \(ctx, payload\) => \{\s*await run_detect_possible_recurring_job\(ctx, payload/);
    }
    const h = await makeHarness(db, 'qzsweep', mocks, { flag: true });
    await h.sync('link');
    // Next day: a sync adds water bills; the detector job is created delayed.
    const tomorrow = NOW_MS + DAY;
    jest.setSystemTime(tomorrow);
    h.postTxns(extras(h.ids).filter((t) => String(t.transaction_id).includes('water')));
    await h.sync('next_day');
    const job_id = det.detector_job_id(h.ids.userId, tomorrow);
    expect((await db.collection('_jobs').doc(job_id).get()).data()?.status).toBe('pending');
    // The sweep, 16 minutes later: pending + due → claimed → handler → completed.
    jest.setSystemTime(tomorrow + 16 * 60 * 1000);
    const pending = await jobq.get_pending_jobs(undefined, 300);
    const mine = pending.find((j: { job_id: string }) => j.job_id === job_id);
    expect(mine).toBeDefined();
    const claimed = await jobq.claim_job(job_id);
    expect(claimed?.status).toBe('processing');
    const out = await job.run_detect_possible_recurring_job(ctx(), claimed.payload);
    await jobq.mark_job_completed(job_id);
    expect(out.ran).toBe(true);
    expect((await db.collection('_jobs').doc(job_id).get()).data()?.status).toBe('completed');
    expect((await items_of(h.ids.userId)).some((i) => i.name === 'City Water' && i.source === 'detector')).toBe(true);
    jest.setSystemTime(NOW_MS);
  }, 180000);

  it('R1: a 5,050-transaction user — one transaction read, bounded reads, cap logged', async () => {
    const h = await makeHarness(db, 'qzbig', mocks, { flag: true });
    await h.sync('link');
    // 5,050 posted purchases in the window, written directly (emulator).
    const writer = db.bulkWriter();
    for (let i = 0; i < 5050; i++) {
      const id = `qzbig_bulk_${i}`;
      writer.set(db.collection('transactions').doc(id), {
        id, transactionId: `pbulk_${i}`, userId: h.ids.userId, ownerId: h.ids.userId, accountId: h.ids.chk,
        isActive: true, isPending: false, type: 'expense', amount: 5 + (i % 30), name: `STORE ${i % 50}`, merchantName: `Store ${i % 50}`,
        plaidPrimaryCategory: 'GENERAL_MERCHANDISE', plaidDetailedCategory: 'GENERAL_MERCHANDISE_OTHER',
        transactionDate: Timestamp.fromMillis(NOW_MS - DAY * (1 + (i % 170))), splits: [{ splitId: 's', amount: 5, outflowId: null, inflowId: null }],
      });
    }
    await writer.close();
    await db.collection('_recurring_review_state').doc(h.ids.userId).update({ detectorLastRunDay: '2037-10-14' });
    const warn = jest.spyOn(console, 'warn');
    const c = startCounting();
    const r = await job.run_detect_possible_recurring_job(ctx(), { user_id: h.ids.userId });
    await new Promise((res) => setTimeout(res, 300));
    const k = c.stop();
    expect(r.ran).toBe(true);
    console.log('[R1] full detector run (forced classifier scan + detector):', JSON.stringify({ reads: k.reads, writes: k.writes, reads_by: k.reads_by, writes_by: k.writes_by }));
    expect(warn.mock.calls.some((a) => String(a[0]).includes('detector:') && String(a[0]).includes('cap'))).toBe(true);
    warn.mockRestore();
    const txn_reads = k.reads_by.transactions ?? 0;
    expect(txn_reads).toBeLessThanOrEqual(5050 + 120); // the ONE window read (+ the scenario's own txns)
    expect(k.reads_by._recurring_review_state).toBeLessThanOrEqual(2);
    expect(k.reads - txn_reads).toBeLessThan(200); // everything else is small
  }, 240000);

  it('R13: flag off → never enqueued; the detector reads nothing', async () => {
    const h = await makeHarness(db, 'qzdoff', mocks, { flag: false });
    h.postTxns(extras(h.ids));
    await h.sync('link');
    expect((await db.collection('_jobs').doc(det.detector_job_id(h.ids.userId, NOW_MS)).get()).exists).toBe(false);
    expect(await items_of(h.ids.userId)).toEqual([]);
    const c = startCounting();
    const r = await det.run_detector_on_scan(ctx(), h.ids.userId, NOW_MS, { txns: [], internal_txn_ids: new Set(), records: [] });
    const k = c.stop();
    expect([r.ran, r.reason, k.reads, k.writes]).toEqual([false, 'flag_off', 0, 0]);
  }, 180000);

  it('purge with open items + state + a pending detector job → all gone; a late job re-creates nothing', async () => {
    const h = await makeHarness(db, 'qzpurge', mocks, { flag: true });
    h.postTxns(extras(h.ids));
    await h.sync('link');
    const uid = h.ids.userId;
    await det.enqueue_detector_job(ctx(), uid, NOW_MS + DAY); // tomorrow's job, pending
    expect((await items_of(uid)).length).toBeGreaterThan(0);
    await purge(ctx(), { user_id: uid, initiated_by: uid, trace_id: 't_purge' });
    expect(await items_of(uid)).toEqual([]);
    expect((await db.collection('_recurring_review_state').doc(uid).get()).exists).toBe(false);
    const j = (await db.collection('_jobs').doc(det.detector_job_id(uid, NOW_MS + DAY)).get()).data();
    expect(j?.status).not.toBe('pending'); // cancelled by payload.user_id
    const late = await job.run_detect_possible_recurring_job(ctx(), { user_id: uid });
    expect(late).toEqual({ ran: false, reason: 'purging' });
    expect(await items_of(uid)).toEqual([]);
    expect((await db.collection('_recurring_review_state').doc(uid).get()).exists).toBe(false);
  }, 180000);
});
