/**
 * Emulator — classifier v2 (Convert-To-Recurring X7): transferMajorityRule + cardPaymentInflowHidden.
 *
 *   - v2 card-side "payment received" inflow: hidden at creation and across 10 classifier runs
 *     (0 writes after creation), not shown as income; budgets / Everything Else unchanged vs a
 *     flag-off twin (P11: hiding it creates no budget-reversing "income return").
 *   - 24-month transfer stream with 6 in-window legs, all paired → hidden.
 *   - borderline stream (40–60 % paired as the window slides) over 30 simulated days, with
 *     forced runs (what share / unshare trigger) → no hide / unhide after the first decision.
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern classifierV2"
 */
import * as admin from 'firebase-admin';
import { FAKE_CLOCK, OCT, makeHarness, plaidTxn, scenarioRecurring, seedMonths } from './helpers/captureHarness';
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
  };
});
jest.mock('../src/utils/encryption', () => {
  const actual = jest.requireActual('../src/utils/encryption');
  return { ...actual, decryptAccessToken: () => 'decrypted-token' };
});

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
let db: FirebaseFirestore.Firestore;
let classify: (ctx: any, uid: string, now: number, opts?: any) => Promise<any>;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  require('../src/functions/orchestrators/periods/derive_period.orchestrator');
  ({ classify_internal_transfers_orchestrator: classify } = require('../src/functions/orchestrators/plaid/classify_internal_transfers.orchestrator'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const DAY = 86400000;

describe('classifier v2 (emulator)', () => {
  it('cardPaymentInflowHidden: hidden at creation + across 10 classifier runs; budgets equal a flag-off twin', async () => {
    const on = await makeHarness(db, 'qzccon', mocks, { flag: true });
    await on.sync('link');
    const off = await makeHarness(db, 'qzccoff', mocks, { flag: false });
    await off.sync('link');
    const CCIN = on.ids.streams.CCIN;
    const read = async () => (await db.collection('inflows').doc(CCIN).get()).data()!;
    expect([(await read()).captureRulesVersion, (await read()).isHidden]).toEqual([2, true]);
    const c = startCounting();
    for (let n = 0; n < 10; n++) await classify(ctx(), on.ids.userId, NOW_MS, { force: true });
    const k = c.stop();
    expect((await read()).isHidden).toBe(true);
    expect([k.writes_by.inflows ?? 0, k.writes_by.inflow_periods ?? 0]).toEqual([0, 0]);
    console.log('[cc] 10 forced classifier runs writes_by:', JSON.stringify(k.writes_by));
    // Not shown as income on the period page (today it is — the flag-off twin still shows it).
    expect(await on.income(OCT, CCIN)).toBeUndefined();
    expect(await off.income(OCT, off.ids.streams.CCIN)).toBeDefined();
    // P11: hiding it moves nothing into / out of budgets. The ONLY Everything-Else difference vs the
    // flag-off twin is the three October payments of the suggestions (Sunbit 50 + Avant 82 + Hulu
    // 17.99), which are normal transactions under v2 — the hidden card credit adds 0.
    const diff = Math.round((await on.eeSpent(OCT) - await off.eeSpent(OCT)) * 100) / 100;
    expect(diff).toBe(149.99);
  }, 180000);

  it('transferMajorityRule: a 24-month transfer stream whose 6 in-window legs all pair → hidden', async () => {
    const tag = 'qzx24';
    const h = await makeHarness(db, tag, mocks, { flag: true });
    h.ids.streams.X24 = `${tag}_S_X24`;
    const legs: string[] = [];
    const txns = [];
    for (let m = 0; m < 6; m++) {
      legs.push(`x24out${m}`);
      txns.push(plaidTxn(h.ids, { key: `x24out${m}`, account: 'chk', amount: 75, days_ago: 6 + 30 * m, name: 'TRANSFER TO SAV2',
        merchant: null, primary: 'TRANSFER_OUT', detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER' }));
      txns.push(plaidTxn(h.ids, { key: `x24in${m}`, account: 'sav', amount: -75, days_ago: 6 + 30 * m, name: 'TRANSFER FROM CHK2',
        merchant: null, primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER' }));
    }
    h.postTxns(txns);
    const rec = scenarioRecurring(h.ids);
    const s = plaidStream(h.ids, 'X24', {
      account: 'chk', keys: legs, amount: 75, description: 'TRANSFER TO SAV2', merchant: null, primary: 'TRANSFER_OUT',
      detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER', frequency: 'MONTHLY', status: 'MATURE', is_active: true,
      first_days_ago: 720, last_days_ago: 6, next_days: 24,
    });
    // 18 more legs older than the pairing window (Plaid's 730-day stream history).
    s.transaction_ids = [...Array.from({ length: 18 }, (_, i) => `${tag}_old_leg_${i}`), ...s.transaction_ids];
    rec.outflow_streams.push(s);
    h.setRecurring(rec);
    await h.sync('link');
    const o = (await db.collection('outflows').doc(h.ids.streams.X24).get()).data()!;
    expect([o.captureRulesVersion, o.isHidden, o.transactionIds.length]).toEqual([2, true, 24]);
  }, 180000);

  it('borderline stream over 30 simulated days (+ forced share/unshare runs) → no flip after the first', async () => {
    const tag = 'qzflip';
    const h = await makeHarness(db, tag, mocks, { flag: true });
    h.ids.streams.FLIP = `${tag}_S_FLIP`;
    const keys: string[] = [];
    const txns = [];
    // A leg every 35 days from ~260 days ago to +40 days; every other one pairs.
    for (let i = 0; i < 9; i++) {
      const days_ago = 260 - i * 35;
      keys.push(`flipout${i}`);
      txns.push(plaidTxn(h.ids, { key: `flipout${i}`, account: 'chk', amount: 120, days_ago, name: 'XFER OUT',
        merchant: null, primary: 'TRANSFER_OUT', detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER' }));
      if (i % 2 === 0) {
        txns.push(plaidTxn(h.ids, { key: `flipin${i}`, account: 'sav', amount: -120, days_ago, name: 'XFER IN',
          merchant: null, primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER' }));
      }
    }
    h.postTxns(txns);
    const rec = scenarioRecurring(h.ids);
    rec.outflow_streams.push(plaidStream(h.ids, 'FLIP', {
      account: 'chk', keys, amount: 120, description: 'XFER OUT', merchant: null, primary: 'TRANSFER_OUT',
      detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER', frequency: 'MONTHLY', status: 'MATURE', is_active: true,
      first_days_ago: 260, last_days_ago: 0, next_days: 35,
    }));
    h.setRecurring(rec);
    await h.sync('link');
    const ref = db.collection('outflows').doc(h.ids.streams.FLIP);
    const states: boolean[] = [(await ref.get()).data()!.isHidden];
    let writes = 0;
    for (let d = 1; d <= 30; d++) {
      jest.setSystemTime(NOW_MS + d * DAY);
      const c = startCounting();
      await classify(ctx(), h.ids.userId, Date.now(), { force: d === 7 || d === 19 }); // share / unshare
      if (d === 7 || d === 19) await classify(ctx(), h.ids.userId, Date.now(), { force: true });
      const k = c.stop();
      writes += (k.writes_by.outflows ?? 0);
      states.push((await ref.get()).data()!.isHidden);
    }
    jest.setSystemTime(NOW_MS);
    const flips = states.slice(1).filter((s, i) => s !== states[i]).length;
    console.log('[flip] hidden states over 30 days:', states.map((s) => (s ? 'H' : '.')).join(''), 'writes', writes);
    expect(flips).toBeLessThanOrEqual(1);
    expect(writes).toBeLessThanOrEqual(1);
  }, 240000);
});
