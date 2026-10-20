/**
 * Emulator — Phase 1 robustness (review round 3 Top-25 + extras).
 *
 *   #14 coalesce under a burst: a non-recurring sync pending, then 2 recurring requests → exactly
 *       2 jobs; running them fetches Plaid recurring once per recurring run; ≤2 dedup reads per
 *       request; the tracked bill is created.
 *   #15 purge mid-sync: the purge runs between the plan and the review write → no review items /
 *       state remain (the guarded writes see the purge state in their transaction).
 *   #16 account removal + restore: open "Still a bill?" + suggested items + held-out ids on an
 *       account → removal closes them; restoring the account reopens them ONCE, then no writes.
 *   #17 retry after a throw between the item write and the state write → idempotent: items once,
 *       state once, ≤1 bump.
 *   #22 detector cadence: scans at 23:59Z and 00:01Z → 2 runs; 10 scans in a day → 1; a skipped
 *       classifier (unchanged fingerprint) → no detector call; invoked daily → ≥1 run per 24h.
 *   extra: PRODUCT_NOT_READY during the Track re-sync → the retry creates the bill later.
 *   extra: 20 duplicate recurring webhooks (flag on) → 1 pending job → 1 sync run.
 *   extra: flag on → off → on: the detector and the answer callable stop and resume; v2 behavior
 *          persists while off.
 */
import * as admin from 'firebase-admin';
import { FAKE_CLOCK, clearFlagFor, makeHarness, scenarioRecurring, seedMonths, setFlag } from './helpers/captureHarness';
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
    remove_item: async () => ({ success: true, already_removed: false, request_id: 'x' }),
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
let outflow_repo: any;
let sync_item: any;
let enqueue_item_sync: any;
let purge: any;
let remove_account: any;
let restore_account: any;
let accounts: any;
let classify: any;
let det: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  ({ sync_item_orchestrator: sync_item, enqueue_item_sync } = require('../src/functions/orchestrators/plaid/sync_item.orchestrator'));
  ({ answer_recurring_review_item_orchestrator: answer } = require('../src/functions/orchestrators/recurring/answer_recurring_review_item.orchestrator'));
  ({ recurring_review_repo } = require('../src/functions/repositories/recurring_review.repo'));
  ({ outflow_repo } = require('../src/functions/repositories'));
  ({ purge_user_data_orchestrator: purge } = require('../src/functions/orchestrators/users/purge_user_data.orchestrator'));
  ({ remove_account_orchestrator: remove_account } = require('../src/functions/orchestrators/accounts/remove_account.orchestrator'));
  ({ restore_account_orchestrator: restore_account } = require('../src/functions/orchestrators/accounts/restore_account.orchestrator'));
  accounts = require('../src/functions/orchestrators/accounts');
  ({ classify_internal_transfers_orchestrator: classify } = require('../src/functions/orchestrators/plaid/classify_internal_transfers.orchestrator'));
  det = require('../src/functions/orchestrators/recurring/detect_possible_recurring.orchestrator');
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const itemsOf = async (uid: string) =>
  (await db.collection('recurring_review_items').where('userId', '==', uid).get()).docs.map((d) => d.data());
const stateOf = async (uid: string) => (await db.collection('_recurring_review_state').doc(uid).get()).data();
const pendingSyncJobs = async (item: string) =>
  (await db.collection('_jobs').where('payload.item_doc_id', '==', item).where('status', '==', 'pending').get())
    .docs.map((d) => d.data()).sort((a, b) => Number(a.payload.recurring) - Number(b.payload.recurring));
/** Run the user's pending jobs of these types through their orchestrators (what on_job_created does). */
async function runJobs(tag: string, types: Record<string, (c: any, p: any) => Promise<unknown>>) {
  for (const [type, run] of Object.entries(types)) {
    const snap = await db.collection('_jobs').where('job_type', '==', type).where('status', '==', 'pending').get();
    for (const d of snap.docs) {
      if (!JSON.stringify(d.data().payload).includes(tag)) continue;
      await run(ctx(), d.data().payload);
      await d.ref.update({ status: 'completed' });
    }
  }
}
/** A new EARLY_DETECTION stream (so a sync writes a fresh tile + held-out ids). */
const earlyStream = (h: any, name: string, keys: string[], merchant = 'Newco') => {
  h.ids.streams[name] = `${h.ids.tag}_S_${name}`;
  return plaidStream(h.ids, name, {
    account: 'chk', keys, amount: 21, description: merchant.toUpperCase(), merchant, primary: 'LOAN_PAYMENTS',
    detailed: 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT', frequency: 'MONTHLY', status: 'EARLY_DETECTION', is_active: true,
    first_days_ago: 40, last_days_ago: 10, next_days: 20,
  });
};

describe('Phase 1 robustness (emulator)', () => {
  it('#14 a non-recurring run pending + 2 recurring requests → 2 jobs; recurring fetched once per recurring run; bill created', async () => {
    const h = await makeHarness(db, 'qzburst', mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    await enqueue_item_sync({ item_doc_id: h.ids.itemDocId, user_id: uid, recurring: false, delay_seconds: 600, reason: 'webhook' });
    const avant = (await itemsOf(uid)).find((i) => i.vendorKey === 'avant')!;
    const c1 = startCounting();
    const tracked = await answer(ctx(), uid, { item_id: avant.id, answer: 'track', frequency: 'monthly' }, NOW_MS); // recurring request #1
    const k1 = c1.stop();
    expect(tracked).toMatchObject({ record_id: h.ids.streams.AVANT, direction: 'outflow' }); // D48: the bill the re-sync makes
    const c2 = startCounting();
    await enqueue_item_sync({ item_doc_id: h.ids.itemDocId, user_id: uid, recurring: true, reason: 'webhook_recurring' }); // #2
    const k2 = c2.stop();
    expect(k1.reads_by._jobs ?? 0).toBeLessThanOrEqual(2);
    expect(k2.reads_by._jobs ?? 0).toBeLessThanOrEqual(2);
    const jobs = await pendingSyncJobs(h.ids.itemDocId);
    expect(jobs.map((j) => j.payload.recurring)).toEqual([false, true]);
    // Run them (in queue order) as on_job_created would.
    for (const j of jobs) {
      const before = mockRecurring.mock.calls.length;
      mockRecurring.mockClear();
      void before;
      // re-install the scenario's responses (h.sync's install) without running a harness sync
      mockRecurring.mockImplementation(async () => scenarioRecurring(h.ids));
      mockSync.mockImplementation(async () => ({ added: [], modified: [], removed: [], next_cursor: 'cz', has_more: false,
        transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE', accounts: [], request_id: 'r' }));
      const r = await sync_item(ctx(), j.payload);
      expect(r.status).toBe('synced');
      expect({ recurring: j.payload.recurring, fetched: mockRecurring.mock.calls.length }).toEqual({ recurring: j.payload.recurring, fetched: j.payload.recurring ? 1 : 0 });
    }
    expect((await db.collection('outflows').doc(h.ids.streams.AVANT).get()).data()?.captureRulesVersion).toBe(2);
  }, 180000);

  it('#15 purge between the plan and the review write → no review items or state remain', async () => {
    const h = await makeHarness(db, 'qzpurgemid', mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    expect((await itemsOf(uid)).length).toBeGreaterThan(0);
    const rec = scenarioRecurring(h.ids);
    rec.outflow_streams.push(earlyStream(h, 'NEWCO', ['newco0', 'newco1']));
    h.setRecurring(rec);
    // 8b's first step is set_plaid_is_active — after the plan and the saves, before any review write.
    const orig = outflow_repo.set_plaid_is_active.bind(outflow_repo);
    let fired = false;
    const spy = jest.spyOn(outflow_repo, 'set_plaid_is_active').mockImplementation(async (...a: unknown[]) => {
      if (!fired) {
        fired = true;
        await purge(ctx(), { user_id: uid, initiated_by: uid, trace_id: 't_purge_mid' });
      }
      return orig(...a);
    });
    await h.syncRaw('during_purge').catch(() => undefined); // the item is gone mid-sync: it may fail later on
    spy.mockRestore();
    expect(fired).toBe(true);
    expect(await itemsOf(uid)).toEqual([]);
    expect(await stateOf(uid)).toBeUndefined();
  }, 180000);

  it('#16 account removal closes its items; restoring the account reopens them once, then nothing is rewritten', async () => {
    const h = await makeHarness(db, 'qzacctrs', mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    h.setRecurring(scenarioRecurring(h.ids, { SPOT: { is_active: false } }));
    await h.sync('spot_off'); // "Still a bill?" for Spotify (chk)
    const open_before = (await itemsOf(uid)).filter((i) => i.status === 'open' && i.accountId === h.ids.chk);
    expect(open_before.map((i) => i.kind).sort()).toEqual(expect.arrayContaining(['still_a_bill', 'suggested']));
    expect((await stateOf(uid))!.suppressedTxnIds.length).toBeGreaterThan(0);

    const rm = await remove_account(ctx(), uid, { account_id: h.ids.chk, idempotency_key: `rm_${Math.random()}`, removal_mode: 'keep_history' } as never);
    expect(rm.success).toBe(true);
    await runJobs(h.ids.tag, { cascade_soft_delete_recurring: accounts.cascade_soft_delete_recurring_orchestrator, cascade_hide_transactions: accounts.cascade_hide_transactions_orchestrator });
    for (const i of open_before) {
      const now = (await recurring_review_repo.get_item(ctx(), i.id))!;
      expect([i.kind, now.status, now.answer]).toEqual([i.kind, 'resolved', 'account_removed']);
    }
    await h.sync('while_removed');
    expect((await itemsOf(uid)).filter((i) => i.status === 'open' && i.accountId === h.ids.chk)).toEqual([]);

    const rs = await restore_account(ctx(), uid, { account_id: h.ids.chk, idempotency_key: `rs_${Math.random()}`, restore_transactions: true, restore_recurring: true });
    expect(rs.success).toBe(true);
    await runJobs(h.ids.tag, { restore_account_recurring: accounts.restore_account_recurring_orchestrator, restore_account_transactions: accounts.restore_account_transactions_orchestrator });
    const c = startCounting();
    await h.sync('restored');
    const first = c.stop();
    const reopened = (await itemsOf(uid)).filter((i) => i.status === 'open' && i.accountId === h.ids.chk);
    expect(reopened.map((i) => i.id).sort()).toEqual(open_before.map((i) => i.id).sort()); // reopened once…
    expect(first.writes_by.recurring_review_items ?? 0).toBe(open_before.length);
    const c2 = startCounting();
    for (let n = 0; n < 3; n++) await h.sync(`again${n}`);
    expect(c2.stop().writes_by.recurring_review_items ?? 0).toBe(0); // …and never rewritten after
  }, 240000);

  it('#17 a throw between the item write and the state write → the retry is idempotent', async () => {
    const h = await makeHarness(db, 'qzretry', mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    const rec = scenarioRecurring(h.ids);
    rec.outflow_streams.push(earlyStream(h, 'NEWCO', ['newco0', 'newco1']));
    h.setRecurring(rec);
    const spy = jest.spyOn(recurring_review_repo, 'apply_state_change').mockRejectedValueOnce(new Error('simulated crash'));
    const c = startCounting();
    await h.syncRaw('crash');
    spy.mockRestore();
    const crash = c.peek();
    expect(crash.writes_by.recurring_review_items ?? 0).toBe(1); // the new tile landed
    expect(crash.writes_by._recurring_review_state ?? 0).toBe(0); // the state write didn't
    await h.sync('retry');
    await h.sync('retry2');
    const k = c.stop();
    expect(k.writes_by.recurring_review_items ?? 0).toBe(1); // items once
    expect(k.writes_by._recurring_review_state ?? 0).toBe(1); // state once
    expect(k.writes_by.user_data_versions ?? 0).toBeLessThanOrEqual(1); // ≤1 bump
    expect((await stateOf(uid))!.suppressedTxnIds).toEqual(expect.arrayContaining([h.ids.txn('newco0'), h.ids.txn('newco1')]));
  }, 180000);

  it('#22 detector cadence: 23:59Z + 00:01Z → 2 runs; 10 scans in a day → 1; skipped classifier → none; daily → ≥1 per 24h', async () => {
    const h = await makeHarness(db, 'qzdetcad', mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    const runs: Array<{ at: number; ran: boolean }> = [];
    const orig = det.run_detector_on_scan;
    const spy = jest.spyOn(det, 'run_detector_on_scan').mockImplementation(async (c: unknown, u: unknown, at: unknown, scan: unknown) => {
      const r = await orig(c, u, at, scan);
      runs.push({ at: at as number, ran: r.ran });
      return r;
    });
    const D = Date.UTC(2037, 9, 20);
    await classify(ctx(), uid, D + 23 * 3600000 + 59 * 60000, { force: true });
    await classify(ctx(), uid, D + 24 * 3600000 + 60000, { force: true });
    expect(runs.map((r) => r.ran)).toEqual([true, true]); // two UTC days → two runs
    runs.length = 0;
    for (let n = 0; n < 10; n++) await classify(ctx(), uid, D + 2 * 86400000 + n * 3600000, { force: true });
    expect(runs.filter((r) => r.ran).length).toBe(1); // ten scans in one day → one run
    runs.length = 0;
    // Unchanged fingerprint, < 24h since the last full scan → the classifier skips its scan → no detector call.
    const skipped = await classify(ctx(), uid, D + 2 * 86400000 + 11 * 3600000);
    expect(skipped.skipped).toBe(true);
    expect(runs).toEqual([]);
    // Invoked once a day (never forced): the 24h backstop forces the scan → the detector runs each day.
    for (let day = 3; day < 6; day++) await classify(ctx(), uid, D + day * 86400000 + 11 * 3600000);
    expect(runs.filter((r) => r.ran).length).toBe(3);
    spy.mockRestore();
  }, 180000);

  it('extra: PRODUCT_NOT_READY during the Track re-sync → nothing lost; the retry creates the bill', async () => {
    const h = await makeHarness(db, 'qznotready', mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    const avant = (await itemsOf(uid)).find((i) => i.vendorKey === 'avant')!;
    await answer(ctx(), uid, { item_id: avant.id, answer: 'track', frequency: 'monthly' }, NOW_MS);
    const before = await stateOf(uid);
    expect(before!.pendingTracks.map((p: any) => p.itemId)).toEqual([avant.id]);
    // The re-sync's recurring fetch fails the way Plaid does while the product isn't ready.
    mockRecurring.mockReset();
    mockRecurring.mockRejectedValue(Object.assign(new Error('PRODUCT_NOT_READY'), { response: { data: { error_code: 'PRODUCT_NOT_READY' } } }));
    mockSync.mockReset();
    mockSync.mockImplementation(async () => ({ added: [], modified: [], removed: [], next_cursor: 'cz', has_more: false,
      transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE', accounts: [], request_id: 'r' }));
    const r = await sync_item(ctx(), { item_doc_id: h.ids.itemDocId, user_id: uid, recurring: true, reason: 'review_track' });
    expect(r.status).toBe('synced'); // not an error for the item sync
    expect((await db.collection('outflows').doc(h.ids.streams.AVANT).get()).exists).toBe(false);
    expect(await stateOf(uid)).toEqual(before); // held-out ids + the pending track untouched
    expect((await recurring_review_repo.get_item(ctx(), avant.id))).toMatchObject({ status: 'resolved', answer: 'track' });
    // Plaid is ready later (webhook / cron): the bill is created, the ids released, the track fulfilled.
    await h.sync('ready');
    const bill = (await db.collection('outflows').doc(h.ids.streams.AVANT).get()).data()!;
    expect([bill.captureRulesVersion, bill.userFrequency]).toEqual([2, 'monthly']);
    const after = (await stateOf(uid))!;
    expect(after.pendingTracks).toEqual([]);
    for (const k of ['avant0', 'avant1', 'avant2']) expect(after.suppressedTxnIds).not.toContain(h.ids.txn(k));
  }, 180000);

  it('extra: 20 duplicate recurring webhooks (flag on) → ONE pending job → one sync run', async () => {
    const h = await makeHarness(db, 'qzwebhook20', mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    for (let n = 0; n < 20; n++) {
      await enqueue_item_sync({ item_doc_id: h.ids.itemDocId, user_id: uid, recurring: true, reason: 'webhook_recurring' });
    }
    const jobs = await pendingSyncJobs(h.ids.itemDocId);
    expect(jobs.length).toBe(1);
    mockRecurring.mockClear();
    const r = await sync_item(ctx(), jobs[0].payload);
    expect([r.status, r.rounds]).toEqual(['synced', 1]);
    expect(mockRecurring.mock.calls.length).toBe(1);
  }, 180000);

  // KNOWN GAP (reported, review round 3 fix round 2 — not fixed here; it is the shared job queue):
  // coalesce_job is check-then-create, so 20 CONCURRENT duplicate requests create 20 sync_item jobs
  // (measured on the emulator: 20 jobs; run at once, 11 of them each ran a full sync — a fast
  // identical re-sync releases the item lease before the next claim). Sequential duplicates
  // coalesce to one (test above).
  // D29 (2026-10-16): deliberately NOT fixed in this project — the atomic coalesce in the shared
  // job queue is its own project right after this one (own branch, tests, review).
  it.todo('20 CONCURRENT duplicate recurring webhooks → 1 sync run (needs an atomic coalesce in job_queue)');

  it('extra: flag on → off → on — the detector and the callable stop and resume; v2 behavior persists while off', async () => {
    const h = await makeHarness(db, 'qzflagcycle', mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    const SPOT = h.ids.streams.SPOT;
    expect((await db.collection('outflows').doc(SPOT).get()).data()?.captureRulesVersion).toBe(2);
    const scan = { txns: [], internal_txn_ids: new Set(), records: [] };
    expect((await det.run_detector_on_scan(ctx(), uid, NOW_MS + 86400000, scan)).ran).toBe(true);
    await clearFlagFor(db, uid);
    expect((await det.run_detector_on_scan(ctx(), uid, NOW_MS + 2 * 86400000, scan)).reason).toBe('flag_off');
    const sunbit = (await itemsOf(uid)).find((i) => i.vendorKey === 'sunbit')!;
    await expect(answer(ctx(), uid, { item_id: sunbit.id, answer: 'not_bill' }, NOW_MS)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    // v2 behavior persists with the flag off: Plaid turning Spotify off keeps it active + asks.
    h.setRecurring(scenarioRecurring(h.ids, { SPOT: { is_active: false } }));
    await h.sync('off_while_flag_off');
    const o = (await db.collection('outflows').doc(SPOT).get()).data()!;
    expect([o.isActive, o.plaidIsActive, o.captureRulesVersion]).toEqual([true, false, 2]);
    expect((await itemsOf(uid)).some((i) => i.kind === 'still_a_bill' && i.recordId === SPOT && i.status === 'open')).toBe(true);
    await setFlag(db, [uid]);
    expect((await det.run_detector_on_scan(ctx(), uid, NOW_MS + 3 * 86400000, scan)).ran).toBe(true);
    expect((await answer(ctx(), uid, { item_id: sunbit.id, answer: 'not_bill' }, NOW_MS)).status).toBe('dismissed');
  }, 180000);
});
