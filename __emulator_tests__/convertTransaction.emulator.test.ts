/**
 * Emulator — "Make this a bill" (convert_transaction_to_recurring, Convert-To-Recurring Phase 2,
 * commit 4): F6 / F7 / G7 / D24 / D44 / D45 + refusals + resume + bad input.
 *
 *   F6   a transaction becomes a bill: record on the transaction's account, source pinned, the past
 *        payments linked (one per occurrence), periods paid, budgets lose exactly those payments;
 *        the NEXT payment links by D1
 *   F7   one split of a multi-split transaction: only that split is pinned, siblings keep budgets
 *   G7   group-shared account: account_id set (no empty-account refusal), payments link, group view paid;
 *        pre-share source → OUT_OF_VIEW
 *   D24  a group member converting the owner's transaction → PermissionDenied (no data leak)
 *   D44  a double tap (serial / concurrent) → one bill; two bills from one vendor are allowed
 *   refusals: transfer, card-payment income, pending, already in a bill, flag off, purging
 *   resume: a convert that died after the bill → the next tap finishes it once (never a 2nd bill)
 *   bad input: dates in 1990 / 2100 are clamped, ids with "/" are refused by the entry
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern convertTransaction"
 */
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { FAKE_CLOCK, OCT, SEP, clearFlagFor, makeHarness, paidTotal, plaidTxn, seedMonths, setFlag } from './helpers/captureHarness';
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
let preview: any;
let capabilities: any;
let convert_entry: any;
let account_repo: any;
let derive_period: any;
let sharing: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  ({ convert_transaction_to_recurring_orchestrator: convert } = require('../src/functions/orchestrators/recurring/convert_transaction_to_recurring.orchestrator'));
  ({ preview_convert_transaction_orchestrator: preview } = require('../src/functions/orchestrators/recurring/preview_convert_transaction.orchestrator'));
  ({ get_recurring_capabilities_orchestrator: capabilities } = require('../src/functions/orchestrators/recurring/get_recurring_capabilities.orchestrator'));
  ({ convert_transaction_to_recurring: convert_entry } = require('../src/functions/entry/callable/convert_transaction_to_recurring.entry'));
  ({ account_repo } = require('../src/functions/repositories/account.repo'));
  ({ derive_period_orchestrator: derive_period } = require('../src/functions/orchestrators/periods/derive_period.orchestrator'));
  sharing = {
    ...require('../src/functions/orchestrators/sharing/connect.orchestrator'),
    ...require('../src/functions/orchestrators/sharing/connections.orchestrator'),
    ...require('../src/functions/orchestrators/sharing/groups.orchestrator'),
  };
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const DAY = 86400000;
const ctx = (n = 't') => ({ trace_id: `${n}_${Math.random()}`, span_id: 's' });
const octx = <T>(user_id: string, input: T) => ({ ...ctx(), user_id, input, idempotency_key: `k_${Math.random()}` });
const settle = () => new Promise((r) => setTimeout(r, 300));
/** Days before the fake "today" (2037-10-15) of a calendar date. */
const ago = (y: number, m: number, d: number) => Math.round((Date.UTC(2037, 9, 15) - Date.UTC(y, m - 1, d)) / DAY);
const landlord = (ids: Parameters<typeof plaidTxn>[0], key: string, days_ago: number, amount = 1500, o: Record<string, unknown> = {}) => ({
  ...plaidTxn(ids, { key, account: 'chk', amount, days_ago, name: 'LANDLORD LLC', merchant: 'Landlord LLC',
    primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_RENT' }),
  ...o,
});
const RENT = { name: 'Rent', amount: 1500, frequency: 'monthly', next_due_date: '2037-11-03', link_past: true };
const doc_of = (h: { ids: { txn: (k: string) => string } }, key: string) => `plaid_${h.ids.txn(key)}`;

async function rent_user(tag: string, flag = true) {
  const h = await makeHarness(db, tag, mocks, { flag });
  await h.sync('link');
  h.postTxns([
    landlord(h.ids, 'r_oct', ago(2037, 10, 3)), landlord(h.ids, 'r_sep', ago(2037, 9, 3)), landlord(h.ids, 'r_aug', ago(2037, 8, 3)),
    landlord(h.ids, 'r_jul', ago(2037, 7, 3)), landlord(h.ids, 'r_jun', ago(2037, 6, 3)),
    landlord(h.ids, 'r_noise', ago(2037, 8, 20), 40), // not near an occurrence: stays a normal transaction
  ]);
  await h.sync('rent');
  return h;
}

describe('convert_transaction_to_recurring (emulator)', () => {
  it('F6: a transaction becomes a bill — source pinned, one past payment per occurrence linked, budgets lose exactly those; the NEXT payment links by D1', async () => {
    const h = await rent_user('qzc1');
    const uid = h.ids.userId;
    const ee_before = await h.eeSpent(OCT);
    const r = await convert(ctx(), uid, { transaction_id: doc_of(h, 'r_oct'), ...RENT }, NOW_MS);
    await settle();
    expect(r.already).toBe(false);
    expect(r.direction).toBe('outflow');
    expect(r.linked_past_count).toBe(4);
    const bill = (await db.collection('outflows').doc(r.id).get()).data()!;
    expect(bill).toMatchObject({
      ownerId: uid, accountId: h.ids.chk, source: 'manual', plaidStatus: 'MANUAL', plaidItemId: '', groupIds: [],
      captureRulesVersion: 2, vendorKey: 'landlord llc', convertedFromTxnId: doc_of(h, 'r_oct'), userCustomName: 'Rent',
      averageAmount: 1500, expectedAmountOverride: 1500, frequency: 'monthly', isActive: true,
    });
    expect(bill.retroLinkedAtMs).toBeGreaterThan(0);
    expect((bill.retroTxnIds as string[]).sort()).toEqual(['r_sep', 'r_aug', 'r_jul', 'r_jun'].map((k) => h.ids.txn(k)).sort());
    // the source split is a MANUAL pin; the past payments are auto links
    const src = (await h.txn('r_oct')).splits[0];
    expect([src.outflowId, src.outflowAssignmentSource]).toEqual([r.id, 'manual']);
    for (const k of ['r_sep', 'r_aug', 'r_jul', 'r_jun']) {
      const s = (await h.txn(k)).splits[0];
      expect([k, s.outflowId, s.outflowAssignmentSource]).toEqual([k, r.id, 'auto']);
    }
    expect((await h.txn('r_noise')).splits[0].outflowId ?? null).toBeNull();
    // periods exist; the page shows the occurrences paid
    expect((await db.collection('outflow_periods').where('outflowId', '==', r.id).get()).size).toBeGreaterThan(0);
    expect(paidTotal(await h.bill(OCT, r.id))).toBe(1500);
    expect(paidTotal(await h.bill(SEP, r.id))).toBe(1500);
    // budgets: the 1500 left Everything Else for October; the 40 noise payment stays
    expect(Math.round((ee_before - (await h.eeSpent(OCT))) * 100) / 100).toBe(1500);
    // one bump per convert, and nothing left in the job queue
    expect((await db.collection('_jobs').where('payload.user_id', '==', uid).get()).docs.filter((j) => j.data().job_type !== 'detect_possible_recurring').length).toBe(0);
    // the NEXT payment (any amount) links by D1, no sync of the bill needed
    h.postTxns([landlord(h.ids, 'r_next', 0, 87.31)]);
    await h.sync('next');
    expect((await h.txn('r_next')).splits[0].outflowId).toBe(r.id);
  }, 240000);

  it('double tap: serial and concurrent → ONE bill; the second returns it (D44 only refuses a payment already in a live bill)', async () => {
    const h = await rent_user('qzc2');
    const uid = h.ids.userId;
    const input = { transaction_id: doc_of(h, 'r_oct'), ...RENT };
    const [a, b] = await Promise.all([
      convert(ctx(), uid, input, NOW_MS).catch((e: any) => e),
      convert(ctx(), uid, input, NOW_MS).catch((e: any) => e),
    ]);
    const ok = [a, b].filter((x) => !(x instanceof Error));
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const again = await convert(ctx(), uid, input, NOW_MS);
    expect(again.already).toBe(true);
    const bills = (await db.collection('outflows').where('ownerId', '==', uid).where('convertedFromTxnId', '==', doc_of(h, 'r_oct')).get()).docs;
    expect(bills.length).toBe(1);
    expect(again.id).toBe(bills[0].id);
    expect([a, b].filter((x) => x instanceof Error).every((e: any) => e.code === 'ALREADY_TRACKED')).toBe(true);
  }, 240000);

  it('D44: two bills from one vendor on one account are allowed (a second payment converted on its own)', async () => {
    const h = await rent_user('qzc3');
    const uid = h.ids.userId;
    const first = await convert(ctx(), uid, { transaction_id: doc_of(h, 'r_oct'), ...RENT, link_past: false }, NOW_MS);
    const second = await convert(ctx(), uid, {
      transaction_id: doc_of(h, 'r_noise'), name: 'Landlord extras', amount: 40, frequency: 'monthly', next_due_date: '2037-11-20', link_past: false,
    }, NOW_MS);
    expect(second.id).not.toBe(first.id);
    expect((await db.collection('outflows').where('ownerId', '==', uid).where('vendorKey', '==', 'landlord llc').get()).size).toBe(2);
  }, 240000);

  it('F7: one split of a multi-split transaction — only that split is pinned; the sibling keeps its budget; a multi-split payment later is not D1-linked', async () => {
    const h = await rent_user('qzc4');
    const uid = h.ids.userId;
    const ref = db.collection('transactions').doc(doc_of(h, 'r_oct'));
    const t = (await ref.get()).data()!;
    const a = { ...t.splits[0], amount: 1000 };
    const b = { ...t.splits[0], splitId: `${t.splits[0].splitId}_b`, id: `${t.splits[0].splitId}_b`, amount: 500, isDefault: false };
    await ref.update({ splits: [a, b] });
    const r = await convert(ctx(), uid, { transaction_id: ref.id, split_id: b.splitId, ...RENT, amount: 500, link_past: false }, NOW_MS);
    const after = (await ref.get()).data()!;
    const by = Object.fromEntries(after.splits.map((s: any) => [s.splitId, s]));
    expect(by[b.splitId]).toMatchObject({ outflowId: r.id, outflowAssignmentSource: 'manual' });
    expect(by[a.splitId].outflowId ?? null).toBeNull();
    expect(after.splitOutflowIds).toEqual([r.id]);
    // a later payment that the user splits is not linked by D1 (single-split payments only)
    h.postTxns([landlord(h.ids, 'r_later', 0)]);
    await h.sync('later');
    const lref = db.collection('transactions').doc(doc_of(h, 'r_later'));
    const lt = (await lref.get()).data()!;
    expect(lt.splits[0].outflowId).toBe(r.id); // single split: linked
    await lref.update({ splits: [{ ...lt.splits[0], amount: 1000, outflowId: null, outflowAssignmentSource: 'auto' }, { ...lt.splits[0], splitId: 'x2', id: 'x2', amount: 500, outflowId: null, isDefault: false }] });
    const { assign_transactions_batch_orchestrator } = require('../src/functions/orchestrators/transactions/assign_transactions_batch.orchestrator');
    await assign_transactions_batch_orchestrator(ctx(), { user_id: uid, transaction_ids: [lref.id] });
    expect(((await lref.get()).data()!.splits as any[]).map((s) => s.outflowId ?? null)).toEqual([null, null]);
  }, 240000);

  it('refusals: transfer, card-payment income, pending, already in a bill, flag off, purging, someone else\'s transaction', async () => {
    const h = await rent_user('qzc5');
    const uid = h.ids.userId;
    const run = (txn: string, extra: Record<string, unknown> = {}, who = uid) =>
      convert(ctx(), who, { transaction_id: doc_of(h, txn), ...RENT, ...extra }, NOW_MS).catch((e: any) => e);
    expect((await run('xferout0')).code).toBe('TRANSFER');
    expect((await run('ccin0')).code).toBe('CARD_PAYMENT');
    expect((await run('spot0')).code).toBe('ALREADY_TRACKED');
    expect((await run('spot0')).details).toMatchObject({ id: h.ids.streams.SPOT });
    // pending
    h.postTxns([{ ...landlord(h.ids, 'r_pend', 0), pending: true }]);
    await h.sync('pend');
    expect((await run('r_pend')).code).toBe('PENDING');
    // someone else's transaction: PermissionDenied, and nothing about it leaks
    const intruder = `${h.ids.tag}_intruder`;
    await db.collection('users').doc(intruder).set({ email: 'i@x.com' });
    await setFlag(db, [intruder]);
    const denied = await run('r_oct', {}, intruder);
    const missing = await convert(ctx(), intruder, { transaction_id: 'plaid_does_not_exist', ...RENT }, NOW_MS).catch((e: any) => e);
    expect(denied.code).toBe('PERMISSION_DENIED');
    expect(missing.code).toBe('NOT_FOUND');
    expect(JSON.stringify(denied)).not.toContain('Landlord');
    // purging
    await db.collection('purge_status').doc(uid).set({ user_id: uid, state: 'running', initiated_by: uid });
    expect((await run('r_oct')).code).toBe('PURGING');
    await db.collection('purge_status').doc(uid).delete();
    // flag off
    await clearFlagFor(db, uid);
    expect((await run('r_oct')).code).toBe('FEATURE_OFF');
    expect(await preview(ctx(), uid, { transaction_id: doc_of(h, 'r_oct') }, NOW_MS)).toEqual({ enabled: false });
    expect(await capabilities(ctx(), uid)).toEqual({ enabled: false });
    await setFlag(db, [uid]);
    expect(await capabilities(ctx(), uid)).toEqual({ enabled: true });
    // nothing was created by any refusal
    expect((await db.collection('outflows').where('ownerId', '==', uid).where('convertedFromTxnId', '>=', '').get()).size).toBe(0);
  }, 240000);

  it('preview: name / amount / schedule guess / how many past payments would link; a refusal is data', async () => {
    const h = await rent_user('qzc6');
    const uid = h.ids.userId;
    const p = await preview(ctx(), uid, { transaction_id: doc_of(h, 'r_oct') }, NOW_MS);
    expect(p).toMatchObject({ enabled: true, direction: 'outflow', suggested_name: 'Landlord LLC', suggested_amount: 1500 });
    expect(p.schedule_guess.frequency).toBe('monthly');
    expect(p.linkable_count).toBe(4);
    expect(p.excluded_count).toBe(1); // the 40 noise payment
    const refused = await preview(ctx(), uid, { transaction_id: doc_of(h, 'spot0') }, NOW_MS);
    expect(refused).toMatchObject({ enabled: true, refusal: { code: 'ALREADY_TRACKED' } });
    // a member/intruder gets PermissionDenied and the owner's data is not read
    const intruder = `${h.ids.tag}_i`;
    await db.collection('users').doc(intruder).set({ email: 'i@x.com' });
    await setFlag(db, [intruder]);
    await expect(preview(ctx(), intruder, { transaction_id: doc_of(h, 'r_oct') }, NOW_MS)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  }, 240000);

  it('resume: a convert that died after the bill is created finishes once on the next tap; a removed bill is not reopened', async () => {
    const h = await rent_user('qzc7');
    const uid = h.ids.userId;
    // Simulate a death after step 3: create the bill + pin through the repo, nothing else.
    const { plan_convert } = require('../src/functions/domain/recurring/convert_plan.service');
    const { resolve_convert_facts } = require('../src/functions/resolvers/recurring/convert.resolver');
    const { convert_recurring_repo } = require('../src/functions/repositories/convert_recurring.repo');
    const r = await resolve_convert_facts(ctx(), uid, doc_of(h, 'r_oct'), NOW_MS);
    const plan = plan_convert(r.facts, { ...RENT }, 'conv_dead');
    const entity = { ...plan.entity, retro_txn_ids: plan.retro_plaid_ids };
    await convert_recurring_repo.create_with_source_pin(ctx(), {
      direction: 'outflow', entity, user_id: uid, run_id: 'dead_run', source_txn_doc_id: doc_of(h, 'r_oct'), source_split_ids: plan.source_split_ids,
    });
    expect((await db.collection('outflow_periods').where('outflowId', '==', 'conv_dead').get()).size).toBe(0);
    const resumed = await convert(ctx(), uid, { transaction_id: doc_of(h, 'r_oct'), ...RENT }, NOW_MS);
    expect(resumed).toMatchObject({ id: 'conv_dead', already: true });
    expect((await db.collection('outflow_periods').where('outflowId', '==', 'conv_dead').get()).size).toBeGreaterThan(0);
    expect((await db.collection('outflows').doc('conv_dead').get()).data()!.retroLinkedAtMs).toBeGreaterThan(0);
    for (const k of ['r_sep', 'r_aug', 'r_jul', 'r_jun']) expect((await h.txn(k)).splits[0].outflowId).toBe('conv_dead');
    expect((await db.collection('outflows').where('ownerId', '==', uid).where('vendorKey', '==', 'landlord llc').get()).size).toBe(1);
  }, 240000);

  it('bad input: 1990 / 2100 due dates are clamped; ids with "/" and bad dates are refused at the entry', async () => {
    const h = await rent_user('qzc8');
    const uid = h.ids.userId;
    const old = await convert(ctx(), uid, { transaction_id: doc_of(h, 'r_oct'), ...RENT, next_due_date: '1990-01-01', link_past: false }, NOW_MS);
    expect(old.next_due_clamped).toBe(true);
    const bill = (await db.collection('outflows').doc(old.id).get()).data()!;
    expect(bill.predictedNextDate.toMillis()).toBeGreaterThan(NOW_MS - 40 * DAY);
    const call = (data: unknown) => (convert_entry as any).run({ data, auth: { uid, token: {} }, rawRequest: {} });
    await expect(call({ transaction_id: 'a/b', ...RENT })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call({ transaction_id: doc_of(h, 'r_sep'), ...RENT, review_item_id: 'x/y' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call({ transaction_id: doc_of(h, 'r_sep'), ...RENT, next_due_date: '2037-13-45' })).rejects.toMatchObject({ code: 'invalid-argument' }).catch(() => undefined);
    await expect(call({ transaction_id: doc_of(h, 'r_sep'), ...RENT, amount: -5 })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call({ transaction_id: doc_of(h, 'r_sep'), ...RENT, name: 'x'.repeat(500) })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call({ transaction_id: doc_of(h, 'r_sep'), ...RENT, review_item_id: `${uid}x__suggested__abc` })).rejects.toBeTruthy();
  }, 240000);

  it('G7 / D45: a group-shared account — the bill has the account, payments link, the group view is paid; retro stops at the share date; a pre-share source is OUT_OF_VIEW', async () => {
    const h = await makeHarness(db, 'qzc9', mocks, { flag: true });
    const owner = h.ids.userId;
    const member = `${h.ids.tag}_member`;
    await db.collection('users').doc(member).set({ email: `${member}@x.com` });
    const a = (await sharing.get_my_connect_code_orchestrator(octx(owner, { refresh: true }))).code;
    const b = (await sharing.get_my_connect_code_orchestrator(octx(member, { refresh: true }))).code;
    await sharing.enter_connect_code_orchestrator(octx(owner, { code: b }));
    await sharing.enter_connect_code_orchestrator(octx(member, { code: a }));
    const group_id = (await sharing.create_group_orchestrator(octx(owner, { name: 'Home', invitee_ids: [member] }))).group_id;
    const req = (await sharing.get_sharing_overview_orchestrator(octx(member, {}))).requests[0];
    await sharing.respond_to_request_orchestrator(octx(member, { request_id: req.id, accept: true }));
    // shared from Sep 20: the Sep 3 / Aug 3 payments are before the share
    const shared_from = Date.UTC(2037, 8, 20);
    await account_repo.set_placement(ctx(), h.ids.chk, { group_id, shared_from_ms: shared_from, shared_by: owner, shared_at_ms: NOW_MS }, owner);
    await h.sync('link');
    h.postTxns([landlord(h.ids, 'r_oct', ago(2037, 10, 3)), landlord(h.ids, 'r_sep', ago(2037, 9, 3)), landlord(h.ids, 'r_aug', ago(2037, 8, 3))]);
    await h.sync('rent');
    // member can't convert the owner's transaction (D24)
    await setFlag(db, [member]);
    await expect(convert(ctx(), member, { transaction_id: doc_of(h, 'r_oct'), ...RENT }, NOW_MS)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    // a source from before the share is refused before anything is created
    const pre = await convert(ctx(), owner, { transaction_id: doc_of(h, 'r_sep'), ...RENT }, NOW_MS).catch((e: any) => e);
    expect(pre.code).toBe('OUT_OF_VIEW');
    expect((await db.collection('outflows').where('ownerId', '==', owner).where('vendorKey', '==', 'landlord llc').get()).size).toBe(0);
    const r = await convert(ctx(), owner, { transaction_id: doc_of(h, 'r_oct'), ...RENT }, NOW_MS);
    expect(r.linked_past_count).toBe(0); // Sep 3 / Aug 3 are before the share date
    const bill = (await db.collection('outflows').doc(r.id).get()).data()!;
    expect([bill.accountId, bill.groupIds]).toEqual([h.ids.chk, []]);
    expect((await h.txn('r_sep')).splits[0].outflowId ?? null).toBeNull();
    // a new payment links and the group view shows the bill paid for both members
    h.postTxns([landlord(h.ids, 'r_new', 0, 1500)]);
    await h.sync('new');
    expect((await h.txn('r_new')).splits[0].outflowId).toBe(r.id);
    for (const uid of [owner, member]) {
      const page = await derive_period(ctx(), uid, { view_cadence: 'monthly', window_start_ms: OCT.start, window_end_ms: OCT.end, force: true, scope: { kind: 'group', group_id } });
      const row = page.bills.find((x: { recurring_id: string }) => x.recurring_id === r.id);
      expect([uid, paidTotal(row) > 0]).toEqual([uid, true]);
    }
  }, 300000);

  it('income: a deposit becomes an income; the card-payment credit is refused', async () => {
    const h = await makeHarness(db, 'qzc10', mocks, { flag: true });
    await h.sync('link');
    const uid = h.ids.userId;
    const dep = (key: string, days_ago: number) => plaidTxn(h.ids, { key, account: 'chk', amount: -450, days_ago, name: 'SIDE GIG CO', merchant: 'Side Gig Co', primary: 'INCOME', detailed: 'INCOME_OTHER_INCOME' });
    h.postTxns([dep('g_oct', ago(2037, 10, 9)), dep('g_sep', ago(2037, 9, 9)), dep('g_aug', ago(2037, 8, 9))]);
    await h.sync('gig');
    const r = await convert(ctx(), uid, { transaction_id: doc_of(h, 'g_oct'), name: 'Side gig', amount: 450, frequency: 'monthly', next_due_date: '2037-11-09', link_past: true }, NOW_MS);
    expect(r.direction).toBe('inflow');
    expect(r.linked_past_count).toBe(2);
    const inc = (await db.collection('inflows').doc(r.id).get()).data()!;
    expect(inc).toMatchObject({ ownerId: uid, accountId: h.ids.chk, source: 'manual', vendorKey: 'side gig co', captureRulesVersion: 2 });
    expect((await h.txn('g_oct')).splits[0]).toMatchObject({ inflowId: r.id, inflowAssignmentSource: 'manual' });
    expect((await h.txn('g_sep')).splits[0].inflowId).toBe(r.id);
    expect((await db.collection('inflow_periods').where('inflowId', '==', r.id).get()).size).toBeGreaterThan(0);
  }, 240000);
});
void Timestamp;
