/**
 * Emulator — what happens to a "Track" answer until (and unless) the bill exists.
 *
 *   - Top-25 #6 (defect 3): the save batch throws on the tracked creation → the state doc is
 *     unchanged (the payments stay held out), the item stays tracked, and the next sync creates
 *     the bill and releases the ids.
 *   - Top-25 #7 (defect 4): the bill never materializes — the stream is gone, rejected, first seen
 *     inactive, the flag is off at the re-sync, or the account / item is removed first. Every cause
 *     ends with NO orphaned held-out ids, no pending track, and a defined outcome:
 *       bill saved unstamped (inactive / flag off) → the user's "track" stands (the bill exists);
 *       gone / rejected / account removed → the item is closed `track_unavailable`.
 */
import * as admin from 'firebase-admin';
import { FAKE_CLOCK, clearFlagFor, makeHarness, scenarioRecurring, seedMonths } from './helpers/captureHarness';
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
let outflow_repo: any;
let remove_account: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  ({ answer_recurring_review_item_orchestrator: answer } = require('../src/functions/orchestrators/recurring/answer_recurring_review_item.orchestrator'));
  ({ outflow_repo } = require('../src/functions/repositories'));
  ({ remove_account_orchestrator: remove_account } = require('../src/functions/orchestrators/accounts/remove_account.orchestrator'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires */

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const item_of = async (uid: string, vendor: string) =>
  (await db.collection('recurring_review_items').where('userId', '==', uid).get()).docs
    .map((d) => d.data()).find((i) => i.kind === 'suggested' && i.vendorKey === vendor)!;
const stateOf = async (uid: string) => (await db.collection('_recurring_review_state').doc(uid).get()).data()!;
const strip = (st: any) => ({ suppressed: [...st.suppressedTxnIds].sort(), dismissed: st.dismissedVendorKeys, pending: st.pendingTracks ?? [] });

describe('a tracked suggestion until its bill exists (emulator)', () => {
  it('#6 save_batch throws on the tracked creation → state unchanged, item still tracked; next sync creates + releases', async () => {
    const h = await makeHarness(db, 'qztrsv', mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    const avant = await item_of(uid, 'avant');
    await answer(ctx(), uid, { item_id: avant.id, answer: 'track', frequency: 'monthly' }, NOW_MS);
    const before = strip(await stateOf(uid));
    expect(before.suppressed).toContain(h.ids.txn('avant0'));
    const spy = jest.spyOn(outflow_repo, 'save_batch').mockRejectedValueOnce(new Error('simulated save failure'));
    await h.sync('fails');
    spy.mockRestore();
    expect((await db.collection('outflows').doc(h.ids.streams.AVANT).get()).exists).toBe(false);
    expect(strip(await stateOf(uid))).toEqual(before);
    expect(await item_of(uid, 'avant')).toMatchObject({ status: 'resolved', answer: 'track' });
    // The payments still never fuzzy-link to anything meanwhile.
    expect((await h.txn('avant0'))?.splits[0].outflowId ?? null).toBeNull();

    await h.sync('retry');
    const bill = (await db.collection('outflows').doc(h.ids.streams.AVANT).get()).data()!;
    expect([bill.captureRulesVersion, bill.userFrequency]).toEqual([2, 'monthly']);
    const after = await stateOf(uid);
    for (const k of ['avant0', 'avant1', 'avant2']) expect(after.suppressedTxnIds).not.toContain(h.ids.txn(k));
    expect((await h.txn('avant0'))?.splits[0].outflowId).toBe(h.ids.streams.AVANT);
  }, 180000);

  const AVANT_KEYS = ['avant0', 'avant1', 'avant2'];
  /** Link, answer "Track" on Avant (UNKNOWN schedule → monthly picked); ids still held out. */
  async function tracked(tag: string) {
    const h = await makeHarness(db, tag, mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    const avant = await item_of(uid, 'avant');
    await answer(ctx(), uid, { item_id: avant.id, answer: 'track', frequency: 'monthly' }, NOW_MS);
    const st = await stateOf(uid);
    expect(st.suppressedTxnIds).toEqual(expect.arrayContaining(AVANT_KEYS.map(h.ids.txn)));
    expect(st.pendingTracks.map((p: any) => p.itemId)).toEqual([avant.id]);
    return { h, uid, avant };
  }
  const noOrphans = async (h: any, uid: string) => {
    const st = await stateOf(uid);
    for (const k of AVANT_KEYS) expect(st.suppressedTxnIds).not.toContain(h.ids.txn(k));
    expect(st.pendingTracks).toEqual([]);
  };
  const withoutAvant = (h: any, o: Record<string, unknown> = {}) => {
    const rec = scenarioRecurring(h.ids, o as never);
    return rec;
  };

  it('#7 stream gone from the response → released; item closed track_unavailable', async () => {
    const { h, uid, avant } = await tracked('qztrgone');
    const rec = withoutAvant(h);
    h.setRecurring({ ...rec, outflow_streams: rec.outflow_streams.filter((x: any) => x.stream_id !== h.ids.streams.AVANT) });
    await h.sync('gone');
    await noOrphans(h, uid);
    expect((await db.collection('recurring_review_items').doc(avant.id).get()).data()).toMatchObject({ status: 'resolved', answer: 'track_unavailable' });
    expect((await db.collection('outflows').doc(h.ids.streams.AVANT).get()).exists).toBe(false);
    // Plaid's guesses about its payments are normal transactions again; nothing re-holds them.
    await h.sync('again');
    await noOrphans(h, uid);
  }, 180000);

  it('#7 stream rejected (fails validation) → released; item closed track_unavailable', async () => {
    const { h, uid, avant } = await tracked('qztrrej');
    // first_date after last_date → the transformer's entity fails validation.
    h.setRecurring(withoutAvant(h, { AVANT: { first_days_ago: 1, last_days_ago: 8 } }));
    await h.sync('rejected');
    await noOrphans(h, uid);
    expect((await db.collection('recurring_review_items').doc(avant.id).get()).data()).toMatchObject({ answer: 'track_unavailable' });
    expect((await db.collection('outflows').doc(h.ids.streams.AVANT).get()).exists).toBe(false);
  }, 180000);

  it('#7 stream first seen inactive → saved unstamped (today\'s handling); released; the track stands', async () => {
    const { h, uid, avant } = await tracked('qztrinact');
    h.setRecurring(withoutAvant(h, { AVANT: { is_active: false } }));
    await h.sync('inactive');
    await noOrphans(h, uid);
    const bill = (await db.collection('outflows').doc(h.ids.streams.AVANT).get()).data()!;
    expect(bill.captureRulesVersion).toBeUndefined();
    expect((await db.collection('recurring_review_items').doc(avant.id).get()).data()).toMatchObject({ status: 'resolved', answer: 'track' });
  }, 180000);

  it('#7 flag off at the re-sync → saved unstamped; released; the track stands', async () => {
    const { h, uid, avant } = await tracked('qztrflag');
    await clearFlagFor(db, uid);
    await h.sync('flag_off');
    await noOrphans(h, uid);
    const bill = (await db.collection('outflows').doc(h.ids.streams.AVANT).get()).data()!;
    expect([bill.captureRulesVersion, bill.isActive]).toEqual([undefined, true]);
    expect((await db.collection('recurring_review_items').doc(avant.id).get()).data()).toMatchObject({ answer: 'track' });
  }, 180000);

  it('#7 account (and with it the item) removed before the re-sync → released; item closed track_unavailable', async () => {
    const { h, uid, avant } = await tracked('qztritem');
    const r = await remove_account(ctx(), uid, { account_id: h.ids.chk, idempotency_key: `qz_${Math.random()}`, removal_mode: 'keep_history' } as never);
    expect(r.success).toBe(true);
    await noOrphans(h, uid);
    expect((await db.collection('recurring_review_items').doc(avant.id).get()).data()).toMatchObject({ answer: 'track_unavailable' });
    // The Plaid item itself goes away: its sync is skipped, and nothing comes back.
    await db.collection('plaid_items').doc(h.ids.itemDocId).update({ isActive: false });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { sync_item_orchestrator } = require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
    const r2 = await sync_item_orchestrator(ctx(), { item_doc_id: h.ids.itemDocId, user_id: uid, recurring: true, reason: 'test' });
    expect(r2.status).toBe('skipped');
    await noOrphans(h, uid);
  }, 180000);
});
