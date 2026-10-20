/**
 * Emulator — fix round 10: an INACTIVE record (Plaid-stale, a D41 old bill) still exists, so its
 * history keeps its links — the engine leaves them (flag off too), and a convert's retro-link never
 * takes them. Only a hard-deleted record's links are free (round 9).
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern fixRound10"
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
let convert: any;
let outflow_repo: any;
let reassign: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  require('../src/functions/orchestrators/periods/derive_period.orchestrator');
  ({ reassign_user_orchestrator: reassign } = require('../src/functions/orchestrators/transactions/reassign_user.orchestrator'));
  ({ convert_transaction_to_recurring_orchestrator: convert } = require('../src/functions/orchestrators/recurring/convert_transaction_to_recurring.orchestrator'));
  ({ outflow_repo } = require('../src/functions/repositories/outflow.repo'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const gym_txn = (h: any, key: string, days_ago: number) => plaidTxn(h.ids, { key, account: 'chk', amount: 35, days_ago, name: 'OLD GYM', merchant: 'Old Gym', primary: 'PERSONAL_CARE', detailed: 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS' });

describe('fix round 10 (emulator): inactive records keep their history', () => {
  it('flag off: a Plaid-stale bill keeps its past payments through a re-assign', async () => {
    const h = await makeHarness(db, 'qzo1', mocks, { flag: false });
    await h.sync('link');
    const SPOT = h.ids.streams.SPOT;
    const links = async () => { const o: unknown[] = []; for (let i = 0; i < 5; i++) o.push((await h.txn(`spot${i}`)).splits[0].outflowId ?? null); return o; };
    expect(await links()).toEqual(Array(5).fill(SPOT)); // so the check below bites
    await outflow_repo.mark_stale(ctx(), [SPOT], h.ids.userId);
    expect((await db.collection('outflows').doc(SPOT).get()).data()!.isActive).toBe(false);
    await reassign(ctx(), { user_id: h.ids.userId, reason: 'recurring_removal' });
    expect(await links()).toEqual(Array(5).fill(SPOT));
  }, 300000);

  it('D41: a convert never takes a payment linked (by split, not stream) to the inactive old bill', async () => {
    const h = await makeHarness(db, 'qzo2', mocks, { flag: true });
    await h.sync('link');
    const GYM = h.ids.streams.GYM;
    expect((await db.collection('outflows').doc(GYM).get()).data()!.isActive).toBe(false);
    h.postTxns([gym_txn(h, 'gymnew', 0), gym_txn(h, 'gymx', 31)]);
    await h.sync('gym');
    const xref = db.collection('transactions').doc(`plaid_${h.ids.txn('gymx')}`);
    const x = (await xref.get()).data()!;
    await xref.update({ splits: x.splits.map((s: any) => ({ ...s, outflowId: GYM, outflowAssignmentSource: 'auto' })) });
    const r = await convert(ctx(), h.ids.userId, { transaction_id: `plaid_${h.ids.txn('gymnew')}`, name: 'Gym', amount: 35, frequency: 'monthly', next_due_date: '2037-11-15', link_past: true }, NOW_MS);
    expect(r.linked_past_count).toBe(0);
    expect((await xref.get()).data()!.splits[0].outflowId).toBe(GYM); // history moves nowhere
  }, 300000);
});
