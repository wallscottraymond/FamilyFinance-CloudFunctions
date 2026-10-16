/**
 * Emulator — what happens to a "Track" answer until (and unless) the bill exists.
 *
 *   - Top-25 #6 (defect 3): the save batch throws on the tracked creation → the state doc is
 *     unchanged (the payments stay held out), the item stays tracked, and the next sync creates
 *     the bill and releases the ids.
 */
import * as admin from 'firebase-admin';
import { FAKE_CLOCK, makeHarness, seedMonths } from './helpers/captureHarness';
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
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  ({ answer_recurring_review_item_orchestrator: answer } = require('../src/functions/orchestrators/recurring/answer_recurring_review_item.orchestrator'));
  ({ outflow_repo } = require('../src/functions/repositories'));
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
});
