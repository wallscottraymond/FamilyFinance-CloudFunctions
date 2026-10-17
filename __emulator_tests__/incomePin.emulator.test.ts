/**
 * Emulator — the manual INCOME pin (Convert-To-Recurring Phase 2, commit 3): X15 / X16 + security.
 *   X15  pin a payroll-stream deposit to ANOTHER income → it pays that income once, not the stream
 *        (derive page, both denorm arrays, survives 3 re-assigns with 0 writes)
 *   X16  pin a deposit to its OWN stream's income → counted once (no double count); clearing returns it
 *   forged pins: updateTransactionSplits strips a client-sent pin (existing + new split);
 *        a budget pin detaches an income pin
 *   security: a debit can't be pinned; another user's income / transaction → PermissionDenied with the
 *        same answer for "missing"; an income in another view → OUT_OF_VIEW; flag off → FEATURE_OFF
 *   the bill pin now checks the bill's owner (guessable conv_ ids) and recomputes the income denorm
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern incomePin"
 */
import * as admin from 'firebase-admin';
import { FAKE_CLOCK, clearFlagFor, makeHarness, seedMonths, OCT } from './helpers/captureHarness';
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
let pin: any;
let assign_batch: any;
let update_splits: any;
let account_repo: any;
let transaction_repo: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  ({ assign_split_to_inflow_orchestrator: pin } = require('../src/functions/orchestrators/recurring/assign_split_to_inflow.orchestrator'));
  ({ assign_transactions_batch_orchestrator: assign_batch } = require('../src/functions/orchestrators/transactions/assign_transactions_batch.orchestrator'));
  ({ updateTransactionSplits: update_splits } = require('../src/functions/transactions/api/crud/updateTransactionSplits'));
  ({ account_repo } = require('../src/functions/repositories/account.repo'));
  ({ transaction_repo } = require('../src/functions/repositories/transaction.repo'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const ctx = (n = 't') => ({ trace_id: `${n}_${Math.random()}`, span_id: 's' });
const settle = () => new Promise((r) => setTimeout(r, 300));
const received = (row: any) => Math.round(((row?.groups ?? []).reduce((s: number, g: any) => s + (g.total_paid ?? 0), 0)) * 100) / 100;

async function setup(tag: string, flag = true) {
  const h = await makeHarness(db, tag, mocks, { flag });
  await h.sync('link');
  const gig = await seedConverted(db, h.ids, {
    id: `${tag}_gig`, direction: 'inflow', name: 'Side gig', amount: 500, vendor_key: 'side gig co', account: 'chk', next_days: 0,
  });
  const pay = h.ids.streams.PAY;
  const pay_key = 'pay0'; // the newest payroll deposit (2 days ago), a member of the PAY stream
  const doc_id = `plaid_${h.ids.txn(pay_key)}`;
  const split_id = (await h.txn(pay_key)).splits[0].splitId as string;
  return { h, gig, pay, pay_key, doc_id, split_id };
}

describe('manual income pin (emulator)', () => {
  it('X15: a stream deposit pinned to ANOTHER income pays that income once; survives re-assigns (0 writes)', async () => {
    const { h, gig, pay, pay_key, doc_id, split_id } = await setup('qzip1');
    const uid = h.ids.userId;
    const before = (await h.txn(pay_key));
    expect(before.splits[0].inflowId).toBe(pay);
    const stream_before = received(await h.income(OCT, pay));
    await pin(ctx(), uid, { transaction_id: doc_id, split_id, inflow_id: gig });
    await settle();
    const after = (await h.txn(pay_key));
    expect(after.splits[0]).toMatchObject({ inflowId: gig, inflowAssignmentSource: 'manual', outflowId: null });
    expect(after.splitInflowIds).toEqual([gig]);
    expect(after.splitOutflowIds).toEqual([]);
    // the engine (run by the write's trigger path in prod; here explicitly) keeps it, 3×, with 0 writes
    for (let i = 0; i < 3; i++) {
      const c = startCounting();
      await assign_batch(ctx('re'), { user_id: uid, transaction_ids: [doc_id] });
      await settle();
      expect(c.stop().writes_by.transactions ?? 0).toBe(0);
    }
    expect((await h.txn(pay_key)).splits[0]).toMatchObject({ inflowId: gig, inflowAssignmentSource: 'manual' });
    // the page: the deposit left the stream and paid the pinned income — once, in total
    const stream_after = received(await h.income(OCT, pay));
    const gig_row = await h.income(OCT, gig);
    expect(stream_before - stream_after).toBe(2000);
    expect(received(gig_row)).toBe(2000);
    // a Plaid re-sync of the same item leaves the pin alone
    await h.sync('resync');
    expect((await h.txn(pay_key)).splits[0]).toMatchObject({ inflowId: gig, inflowAssignmentSource: 'manual' });
  }, 240000);

  it('X16: a pin to the deposit\'s OWN stream income counts once; clearing returns to auto', async () => {
    const { h, pay, pay_key, doc_id, split_id } = await setup('qzip2');
    const uid = h.ids.userId;
    const base = received(await h.income(OCT, pay));
    await pin(ctx(), uid, { transaction_id: doc_id, split_id, inflow_id: pay });
    await settle();
    expect((await h.txn(pay_key)).splits[0]).toMatchObject({ inflowId: pay, inflowAssignmentSource: 'manual' });
    expect(received(await h.income(OCT, pay))).toBe(base); // not doubled
    await pin(ctx(), uid, { transaction_id: doc_id, split_id, inflow_id: null });
    await settle();
    await assign_batch(ctx('re'), { user_id: uid, transaction_ids: [doc_id] });
    const cleared = (await h.txn(pay_key)).splits[0];
    expect(cleared.inflowId).toBe(pay); // auto-derived from the stream again
    expect(cleared.inflowAssignmentSource ?? 'auto').toBe('auto');
    expect(received(await h.income(OCT, pay))).toBe(base);
  }, 240000);

  it('forged pins: updateTransactionSplits strips a client-sent pin; a budget pin detaches an income pin', async () => {
    const { h, gig, pay_key, doc_id } = await setup('qzip3');
    const uid = h.ids.userId;
    const t = (await h.txn(pay_key));
    const edit = (splits: any[]) => (update_splits as any).run({ data: { transactionId: doc_id, splits }, auth: { uid, token: {} }, rawRequest: {} });
    // forged on an existing split + a brand-new split
    await edit([
      { ...t.splits[0], amount: 1999, inflowAssignmentSource: 'manual', inflowId: gig },
      { splitId: 'new_1', amount: 1, inflowAssignmentSource: 'manual', inflowId: gig },
    ]);
    const forged = (await h.txn(pay_key));
    for (const s of forged.splits) {
      expect(s.inflowAssignmentSource ?? 'auto').toBe('auto');
      expect(s.inflowId === gig).toBe(false);
    }
    // a real pin, then a budget pin on it: the income pin is detached
    await edit([{ ...forged.splits[0] }]);
    await pin(ctx(), uid, { transaction_id: doc_id, split_id: forged.splits[0].splitId, inflow_id: gig });
    await settle();
    const ee = (await db.collection('budgets').where('userId', '==', uid).where('period', '==', 'monthly').get()).docs[0]?.id;
    const pinned = (await h.txn(pay_key));
    expect(pinned.splits[0].inflowAssignmentSource).toBe('manual');
    await edit([{ ...pinned.splits[0], budgetAssignmentSource: 'manual', budgetId: ee }]);
    await settle();
    const detached = (await h.txn(pay_key)).splits[0];
    expect([detached.inflowId, detached.inflowAssignmentSource]).toEqual([null, 'auto']);
  }, 240000);

  it('security: debit, foreign income / transaction, other view, flag off', async () => {
    const { h, gig, doc_id, split_id } = await setup('qzip4');
    const uid = h.ids.userId;
    // a debit cannot be pinned to income
    const debit_doc = `plaid_${h.ids.txn('spot0')}`;
    const debit_split = (await h.txn('spot0')).splits[0].splitId;
    await expect(pin(ctx(), uid, { transaction_id: debit_doc, split_id: debit_split, inflow_id: gig }))
      .rejects.toMatchObject({ code: 'NOT_AN_INCOME_PAYMENT' });
    // another user probing the owner's transaction / income
    const intruder = `${h.ids.tag}_intruder`;
    await db.collection('users').doc(intruder).set({ email: 'i@x.com' });
    const { setFlag } = require('./helpers/captureHarness');
    await setFlag(db, [intruder]);
    await expect(pin(ctx(), intruder, { transaction_id: doc_id, split_id, inflow_id: gig }))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    // …and the owner pinning to someone else's income / a made-up one gets the same answer
    const other_income = await seedConverted(db, { ...h.ids, userId: intruder } as any, { id: `${h.ids.tag}_theirs`, direction: 'inflow', name: 'Theirs', amount: 5, vendor_key: 'x', account: 'chk' });
    const foreign = await pin(ctx(), uid, { transaction_id: doc_id, split_id, inflow_id: other_income }).catch((e: any) => e);
    const missing = await pin(ctx(), uid, { transaction_id: doc_id, split_id, inflow_id: 'does_not_exist' }).catch((e: any) => e);
    expect(foreign.code).toBe('PERMISSION_DENIED');
    expect(missing.code).toBe(foreign.code);
    expect(missing.message).toBe(foreign.message);
    // an income in another view: the transaction's account is shared into a group, the income's isn't
    const gig_sav = await seedConverted(db, h.ids, { id: `${h.ids.tag}_gig_sav`, direction: 'inflow', name: 'Savings interest', amount: 5, vendor_key: 'bank', account: 'sav' });
    await account_repo.set_placement(ctx(), h.ids.chk, { group_id: 'g_x', shared_from_ms: null, shared_by: uid, shared_at_ms: 1 }, uid);
    await expect(pin(ctx(), uid, { transaction_id: doc_id, split_id, inflow_id: gig_sav }))
      .rejects.toMatchObject({ code: 'OUT_OF_VIEW' });
    await account_repo.set_placement(ctx(), h.ids.chk, null, uid);
    // flag off
    await clearFlagFor(db, uid);
    await expect(pin(ctx(), uid, { transaction_id: doc_id, split_id, inflow_id: gig }))
      .rejects.toMatchObject({ code: 'FEATURE_OFF' });
  }, 240000);

  it('the bill pin checks the bill\'s owner and recomputes the income denorm', async () => {
    const { h, gig, pay_key, doc_id, split_id } = await setup('qzip5');
    const uid = h.ids.userId;
    // pin the deposit to income, then (a different path) to a bill: the income denorm is recomputed
    await pin(ctx(), uid, { transaction_id: doc_id, split_id, inflow_id: gig });
    const intruder = `${h.ids.tag}_o`;
    const theirs = await seedConverted(db, { ...h.ids, userId: intruder } as any, { id: `${h.ids.tag}_bill_theirs`, name: 'Theirs', amount: 5, vendor_key: 'x', account: 'chk' });
    await expect(transaction_repo.pin_split_to_outflow(ctx(), doc_id, split_id, theirs, uid)).rejects.toThrow();
    const mine = await seedConverted(db, h.ids, { id: `${h.ids.tag}_bill_mine`, name: 'Mine', amount: 5, vendor_key: 'x', account: 'chk' });
    await transaction_repo.pin_split_to_outflow(ctx(), doc_id, split_id, mine, uid);
    const after = await h.txn(pay_key);
    expect(after.splitOutflowIds).toEqual([mine]);
    expect(after.splitInflowIds).toEqual([]);
    expect(after.splits[0].inflowId).toBeNull();
  }, 240000);
});
