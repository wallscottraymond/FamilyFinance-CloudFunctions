/**
 * Emulator — reviewItemAnswers (Convert-To-Recurring Phase 1 answer callable).
 *
 *   - Track a Plaid suggestion (Avant, UNKNOWN schedule) → a schedule is required; with one the item
 *     closes, its payments are released, the item re-syncs and the v2 bill exists with the picked
 *     schedule (D8). F3: a payment Plaid adds to the stream links. F4: one Plaid hasn't added yet
 *     (same merchant + account) links too.
 *   - Not a bill → vendor remembered; the stream maturing later never becomes a bill (X14).
 *   - Still a bill → remembered on the record, never asked again. It ended → the going-forward end.
 *   - Keep separate → its own bill.
 *   - R12: the same answer 10× → one state change, the rest no-ops.
 *   - D24: a group member answering the owner's item → PermissionDenied; forged ids denied.
 *   - G4: a member's own "Not a bill" changes only the member's memory.
 *   - Flag off → refused.
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern reviewItemAnswers"
 */
import * as admin from 'firebase-admin';
import {
  FAKE_CLOCK, OCT, clearFlagFor, makeHarness, plaidTxn, scenarioRecurring, seedMonths,
} from './helpers/captureHarness';
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
  };
});
jest.mock('../src/utils/encryption', () => {
  const actual = jest.requireActual('../src/utils/encryption');
  return { ...actual, decryptAccessToken: () => 'decrypted-token' };
});

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
let db: FirebaseFirestore.Firestore;
let answer: (ctx: any, uid: string, input: any, now: number) => Promise<any>;
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
const items_of = async (uid: string) =>
  (await db.collection('recurring_review_items').where('userId', '==', uid).get()).docs.map((d) => d.data());
const item_named = async (uid: string, name: string, kind = 'suggested') =>
  (await items_of(uid)).find((i) => i.name === name && i.kind === kind)!;
const avantTxn = (ids: Parameters<typeof plaidTxn>[0], key: string, days_ago: number, amount = 101) =>
  plaidTxn(ids, { key, account: 'chk', amount, days_ago, name: 'AVANT LOAN', merchant: 'Avant',
    primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT' });

describe('answering review items (emulator)', () => {
  it('track (with a picked schedule) → v2 bill; F3 + F4 go-forward', async () => {
    const h = await makeHarness(db, 'qzans', mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    const avant = await item_named(uid, 'Avant');
    expect(avant.frequency).toBeNull();
    await expect(answer(ctx(), uid, { item_id: avant.id, answer: 'track' }, NOW_MS)).rejects.toThrow(/schedule/);
    const r = await answer(ctx(), uid, { item_id: avant.id, answer: 'track', frequency: 'monthly' }, NOW_MS);
    expect([r.status, r.no_op]).toEqual(['resolved', false]);
    // Still held out until the bill exists (released by the planner at creation, not at answer).
    const state = (await db.collection('_recurring_review_state').doc(uid).get()).data()!;
    expect(state.suppressedTxnIds).toContain(h.ids.txn('avant0'));
    const jobs = await db.collection('_jobs').where('payload.user_id', '==', uid).where('job_type', '==', 'sync_item').get();
    expect(jobs.size).toBeGreaterThan(0); // the item re-sync was queued
    await h.sync('after_track'); // what that job runs
    expect((await db.collection('_recurring_review_state').doc(uid).get()).data()!.suppressedTxnIds).not.toContain(h.ids.txn('avant0'));
    const rec = (await db.collection('outflows').doc(h.ids.streams.AVANT).get()).data()!;
    expect([rec.captureRulesVersion, rec.isActive, rec.frequency, rec.userFrequency]).toEqual([2, true, 'monthly', 'monthly']);
    expect((await h.txn('avant0'))?.splits[0].outflowId).toBe(h.ids.streams.AVANT); // history linked
    // F3: Plaid adds the next payment to the stream.
    h.postTxns([avantTxn(h.ids, 'avantnew', 0)]);
    h.setRecurring(scenarioRecurring(h.ids, { AVANT: { transaction_keys: ['avant0', 'avant1', 'avant2', 'avantnew'] } }));
    await h.sync('f3');
    expect((await h.txn('avantnew'))?.splits[0].outflowId).toBe(h.ids.streams.AVANT);
    // F4: a payment Plaid hasn't added to the stream yet (same merchant + account) still links.
    jest.setSystemTime(Date.parse('2037-11-06T12:00:00Z'));
    h.postTxns([avantTxn(h.ids, 'avantf4', 0, 88)].map((t) => ({ ...t, date: '2037-11-06', authorized_date: '2037-11-06' })));
    await h.sync('f4');
    jest.setSystemTime(NOW_MS);
    expect((await h.txn('avantf4'))?.splits[0].outflowId).toBe(h.ids.streams.AVANT);
  }, 180000);

  it('not a bill → vendor remembered; maturing later never creates it (X14); R12 idempotent', async () => {
    const h = await makeHarness(db, 'qznot', mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    const sunbit = await item_named(uid, 'Sunbit');
    const c = startCounting();
    const results = [];
    for (let n = 0; n < 10; n++) results.push(await answer(ctx(), uid, { item_id: sunbit.id, answer: 'not_bill' }, NOW_MS));
    const k = c.stop();
    expect(results.map((r) => r.no_op)).toEqual([false, true, true, true, true, true, true, true, true, true]);
    expect(k.writes_by._recurring_review_state).toBe(1);
    expect(k.writes_by.recurring_review_items).toBe(1);
    const state = (await db.collection('_recurring_review_state').doc(uid).get()).data()!;
    expect(state.dismissedVendorKeys).toEqual(['outflow:sunbit']);
    // Sunbit matures → still not a bill; its payments stay normal transactions.
    h.setRecurring(scenarioRecurring(h.ids, { SUNBIT: { status: 'MATURE' } }));
    await h.sync('matured');
    expect((await db.collection('outflows').doc(h.ids.streams.SUNBIT).get()).exists).toBe(false);
    expect((await h.txn('sunbit0'))?.splits[0].outflowId ?? null).toBeNull();
    // A different answer now is refused.
    await expect(answer(ctx(), uid, { item_id: sunbit.id, answer: 'track' }, NOW_MS)).rejects.toThrow(/already answered/);
  }, 180000);

  it('still a bill (remembered, never re-asked) / it ended (going-forward end)', async () => {
    const h = await makeHarness(db, 'qzstill', mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    h.setRecurring(scenarioRecurring(h.ids, { SPOT: { is_active: false }, CCPAY: { is_active: false } }));
    await h.sync('off');
    const q_spot = (await items_of(uid)).find((i) => i.kind === 'still_a_bill' && i.recordId === h.ids.streams.SPOT)!;
    const q_cc = (await items_of(uid)).find((i) => i.kind === 'still_a_bill' && i.recordId === h.ids.streams.CCPAY)!;
    await answer(ctx(), uid, { item_id: q_spot.id, answer: 'still_a_bill' }, NOW_MS);
    expect((await db.collection('outflows').doc(h.ids.streams.SPOT).get()).data()?.plaidInactiveAckAt).toBeDefined();
    await answer(ctx(), uid, { item_id: q_cc.id, answer: 'it_ended' }, NOW_MS);
    const cc = (await db.collection('outflows').doc(h.ids.streams.CCPAY).get()).data()!;
    expect([cc.isActive, cc.removalIntervals.length, cc.removalIntervals[0].mode]).toEqual([true, 1, 'going_forward']);
    // Re-syncs: nothing re-asked, nothing rewritten.
    for (let n = 0; n < 3; n++) await h.sync(`re${n}`);
    expect((await items_of(uid)).filter((i) => i.kind === 'still_a_bill' && i.status === 'open')).toEqual([]);
    expect(await h.bill(OCT, h.ids.streams.SPOT)).toBeDefined();
  }, 180000);

  it('D24 / G4 / flag: a member is denied on the owner\'s item; forged ids denied; own "Not a bill" is per person', async () => {
    const owner = await makeHarness(db, 'qzowner', mocks, { flag: true });
    await owner.sync('link');
    const member = await makeHarness(db, 'qzmember', mocks, { flag: true });
    await member.sync('link');
    const owner_item = await item_named(owner.ids.userId, 'Avant');
    await expect(answer(ctx(), member.ids.userId, { item_id: owner_item.id, answer: 'not_bill' }, NOW_MS))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    // A forged id under the member's prefix with the owner's hash: not the member's item → not found.
    const forged = owner_item.id.replace(owner.ids.userId, member.ids.userId);
    const member_avant = await item_named(member.ids.userId, 'Avant');
    expect(forged).toBe(member_avant.id); // same subject → the member's OWN item (ids are per owner)
    await expect(answer(ctx(), member.ids.userId, { item_id: `${member.ids.userId}__suggested__deadbeef`, answer: 'not_bill' }, NOW_MS))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    // G4: the member's own "Not a bill" changes only the member's memory.
    await answer(ctx(), member.ids.userId, { item_id: member_avant.id, answer: 'not_bill' }, NOW_MS);
    const ms = (await db.collection('_recurring_review_state').doc(member.ids.userId).get()).data()!;
    const os = (await db.collection('_recurring_review_state').doc(owner.ids.userId).get()).data()!;
    expect(ms.dismissedVendorKeys).toEqual(['outflow:avant']);
    expect(os.dismissedVendorKeys).toEqual([]);
    expect((await item_named(owner.ids.userId, 'Avant')).status).toBe('open');
    // Flag off → the callable refuses.
    await clearFlagFor(db, owner.ids.userId);
    await expect(answer(ctx(), owner.ids.userId, { item_id: owner_item.id, answer: 'not_bill' }, NOW_MS))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  }, 180000);

  it('a vendor key with "/" makes a valid item id that can be written, read and answered', async () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const ff = require('../src/functions/infrastructure/feature_flags');
    const { recurring_review_repo } = require('../src/functions/repositories/recurring_review.repo');
    const { make_review_item } = require('../src/functions/domain/recurring/review_item.service');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const uid = `rs_${Date.now()}`;
    await db.collection(process.env.FEATURE_FLAGS_COLLECTION_OVERRIDE ?? '_feature_flags').doc('convert_to_recurring_v1').set({
      enabled: true, enabled_user_ids: [uid], enabled_group_ids: [], rollout_percentage: 0,
    });
    ff.invalidate_flag_cache();
    const it_ = make_review_item({
      user_id: uid, kind: 'suggested', direction: 'outflow', source: 'plaid', status: 'open', answer: null,
      subject_key: 'outflow:paypal /inst xfer', vendor_key: 'paypal /inst xfer', account_id: 'acct1', plaid_item_doc_id: 'item',
      stream_id: 's', record_id: null, name: 'PayPal', amount: 10, frequency: 'monthly', plaid_status: 'EARLY_DETECTION',
      category: null, transaction_ids: [], next_due_ms: null, user_frequency: null, resolved_at_ms: null,
    }, Date.now());
    expect(it_.id).not.toContain('/');
    await recurring_review_repo.upsert_items(ctx(), [it_]);
    expect((await recurring_review_repo.get_items_by_ids(ctx(), [it_.id])).get(it_.id)?.subject_key).toBe('outflow:paypal /inst xfer');
    const r = await answer(ctx(), uid, { item_id: it_.id, answer: 'not_bill' }, Date.now());
    expect(r.status).toBe('dismissed');
    const state = (await db.collection('_recurring_review_state').doc(uid).get()).data()!;
    expect(state.dismissedVendorKeys).toEqual(['outflow:paypal /inst xfer']);
  });
});
