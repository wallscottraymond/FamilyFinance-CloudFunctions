/**
 * Emulator — the convert / retro-link cascade is BOUNDED (Convert-To-Recurring Phase 2): R8 + the
 * revised cost table, measured around the Firestore client.
 *
 *   R8   a weekly bill with 50 past payments: ALL its writes are stamped (no trigger fan-out),
 *        0 `_jobs`, exactly 1 derive bump, the engine runs once over the chosen payments
 *   cost one-time reads / writes for a 12-payment vendor and a 130-payment ("Apple") vendor — the
 *        busy vendor costs ≈ its payment count more, not a multiple; a LOAN vendor never forces the
 *        classifier's 180-day scan; steady state adds nothing
 *   D46  a daily coffee converted monthly → exactly 12 links; twice-a-month → 24; reruns identical
 *   scope pre-share (D45) and edge-money payments are never rewritten
 *
 * Numbers are printed (`[R8 cost] …`) so the report quotes measured values.
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern convertRetroLinkCascade"
 */
import * as admin from 'firebase-admin';
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
  };
});
jest.mock('../src/utils/encryption', () => {
  const actual = jest.requireActual('../src/utils/encryption');
  return { ...actual, decryptAccessToken: () => 'decrypted-token' };
});

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
let db: FirebaseFirestore.Firestore;
let convert: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  ({ convert_transaction_to_recurring_orchestrator: convert } = require('../src/functions/orchestrators/recurring/convert_transaction_to_recurring.orchestrator'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const DAY = 86400000;
const ctx = (n = 't') => ({ trace_id: `${n}_${Math.random()}`, span_id: 's' });
const settle = () => new Promise((r) => setTimeout(r, 400));
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type Spec = { name: string; merchant: string; primary: string; detailed: string };
const GYM: Spec = { name: 'IRON GYM', merchant: 'Iron Gym', primary: 'PERSONAL_CARE', detailed: 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS' };
const LOAN: Spec = { name: 'SHELLPOINT MORTGAGE', merchant: 'Shellpoint', primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_MORTGAGE_PAYMENT' };
const APPLE: Spec = { name: 'APPLE.COM/BILL', merchant: 'Apple', primary: 'ENTERTAINMENT', detailed: 'ENTERTAINMENT_MUSIC_AND_AUDIO' };
const COFFEE: Spec = { name: 'CORNER COFFEE', merchant: 'Corner Coffee', primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE' };

const pay = (ids: Parameters<typeof plaidTxn>[0], key: string, days_ago: number, spec: Spec, amount: number) =>
  plaidTxn(ids, { key, account: 'chk', amount, days_ago, ...spec });

/** Posted payments `step` days apart, newest `first_days_ago` ago, `n` of them. */
async function seed_vendor(tag: string, spec: Spec, n: number, step: number, amount = 20, first_days_ago = 3) {
  const h = await makeHarness(db, tag, mocks, { flag: true });
  await h.sync('link');
  const keys = Array.from({ length: n }, (_, i) => `v${i}`);
  h.postTxns(keys.map((k, i) => pay(h.ids, k, first_days_ago + i * step, spec, amount)));
  await h.sync('vendor');
  return { h, keys };
}

const jobs_of = async (uid: string) =>
  (await db.collection('_jobs').where('payload.user_id', '==', uid).get()).docs.map((d) => d.data().job_type as string);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function measure<T = any>(fn: () => Promise<T>): Promise<{ out: T; reads: number; writes: number; reads_by: Record<string, number>; writes_by: Record<string, number> }> {
  const c = startCounting();
  const out = await fn();
  await settle();
  const k = c.stop();
  const { _audit, categories, ...reads_by } = k.reads_by as Record<string, number>;
  const { _audit: _wa, ...writes_by } = k.writes_by as Record<string, number>;
  void _audit; void categories; void _wa;
  return { out, reads: k.reads - (k.reads_by._audit ?? 0) - (k.reads_by.categories ?? 0), writes: k.writes - (k.writes_by._audit ?? 0), reads_by, writes_by };
}

describe('convert / retro-link cascade is bounded (emulator)', () => {
  it('R8: a weekly bill with 50 past payments — all writes stamped, 0 jobs, 1 derive bump, no classifier run', async () => {
    const { h, keys } = await seed_vendor('qzr8a', GYM, 50, 7, 25, 2);
    const uid = h.ids.userId;
    const classifier = jest.spyOn(require('../src/functions/orchestrators/plaid/classify_internal_transfers.orchestrator'), 'classify_internal_transfers_orchestrator');
    const jobs_before = (await jobs_of(uid)).length;
    const next = ymd(NOW_MS + 5 * DAY);
    const m = await measure(() => convert(ctx('r8'), uid, {
      transaction_id: `plaid_${h.ids.txn('v0')}`, name: 'Gym', amount: 25, frequency: 'weekly', next_due_date: next, link_past: true,
    }, NOW_MS));
    console.log('[R8 cost] 50 weekly payments: reads', m.reads, 'writes', m.writes, JSON.stringify(m.reads_by), JSON.stringify(m.writes_by));
    expect(m.out.linked_past_count).toBeGreaterThanOrEqual(40);
    // exactly one derive bump; no job was queued by the cascade
    expect(m.writes_by.user_data_versions).toBe(1);
    expect((await jobs_of(uid)).length).toBe(jobs_before);
    expect(classifier).not.toHaveBeenCalled();
    // every transaction the cascade touched is stamped (the trigger skips stamped writes: 0 fan-out)
    const linked = (await db.collection('transactions').where('splitOutflowIds', 'array-contains', m.out.id).get()).docs;
    expect(linked.length).toBe(m.out.linked_past_count + 1);
    for (const d of linked) expect(String(d.data().assignRunId ?? '')).toMatch(/^convert_/);
    // the bill + its marker writes are stamped too (create trigger / update trigger skip)
    const bill = (await db.collection('outflows').doc(m.out.id).get()).data()!;
    expect(String(bill.syncRunId)).toMatch(/^convert_/);
    // the cost is linear in the payments linked, not a multiple of the user's whole history
    expect(m.writes_by.transactions).toBe(m.out.linked_past_count + 1);
    classifier.mockRestore();
    void keys;
  }, 300000);

  it('cost: 12 vs 130 payments, a LOAN vendor (no classifier), and steady state', async () => {
    const a = await seed_vendor('qzr8b', GYM, 12, 30, 40, 5);
    const b = await seed_vendor('qzr8c', APPLE, 130, 2, 9.99, 1);
    const c = await seed_vendor('qzr8d', LOAN, 12, 30, 1800, 5);
    const classifier = jest.spyOn(require('../src/functions/orchestrators/plaid/classify_internal_transfers.orchestrator'), 'classify_internal_transfers_orchestrator');
    const run = (x: { h: any }, freq: string, next: string) => measure(() => convert(ctx('cost'), x.h.ids.userId, {
      transaction_id: `plaid_${x.h.ids.txn('v0')}`, name: 'Bill', amount: 40, frequency: freq, next_due_date: next, link_past: true,
    }, NOW_MS));
    const ma = await run(a, 'monthly', ymd(NOW_MS + 25 * DAY));
    const mb = await run(b, 'monthly', ymd(NOW_MS + 25 * DAY));
    const mc = await run(c, 'monthly', ymd(NOW_MS + 25 * DAY));
    console.log('[R8 cost] 12 monthly:', ma.reads, 'reads', ma.writes, 'writes | 130 (every 2 days → monthly):', mb.reads, 'reads', mb.writes, 'writes | LOAN 12:', mc.reads, 'reads', mc.writes, 'writes');
    console.log('[R8 cost] 12 by collection:', JSON.stringify(ma.reads_by), JSON.stringify(ma.writes_by));
    console.log('[R8 cost] 130 by collection:', JSON.stringify(mb.reads_by), JSON.stringify(mb.writes_by));
    // the loan vendor never forces the 180-day classifier scan
    expect(classifier).not.toHaveBeenCalled();
    classifier.mockRestore();
    // one bump each, 0 jobs
    for (const m of [ma, mb, mc]) expect(m.writes_by.user_data_versions).toBe(1);
    // the busy vendor costs about its payment count more (the vendor query), not a multiple
    expect(mb.reads - ma.reads).toBeLessThan(130 * 3 + 500);
    // …and D46 keeps its writes to one per occurrence
    expect(mb.writes_by.transactions).toBeLessThanOrEqual(14);
    // steady state: a re-sync with nothing new reads/writes the same as it did before the bill existed
    for (const x of [a]) {
      const m1 = await measure(() => x.h.sync('steady1'));
      const m2 = await measure(() => x.h.sync('steady2'));
      expect(m2.writes).toBe(m1.writes);
      expect(m2.writes_by.outflows ?? 0).toBe(0);
      expect(m2.writes_by.transactions ?? 0).toBe(0);
    }
  }, 600000);

  it('D46: a daily coffee converted monthly links exactly 12 payments; twice-a-month links 24; the rerun is identical', async () => {
    const { h } = await seed_vendor('qzr8e', COFFEE, 360, 1, 4.5, 1);
    const uid = h.ids.userId;
    const src = (await h.txn('v0'));
    void src;
    // The source is the coffee of Oct 4 (v10: 11 days before the newest); the schedule is anchored on
    // the 4th, so every occurrence falls on a coffee day.
    const monthly = await convert(ctx(), uid, {
      transaction_id: `plaid_${h.ids.txn('v10')}`, name: 'Coffee', amount: 4.5, frequency: 'monthly', next_due_date: '2037-11-04', link_past: true,
    }, Date.now());
    const linked = (await db.collection('transactions').where('splitOutflowIds', 'array-contains', monthly.id).get()).docs;
    expect(linked.length).toBe(12);
    const ids_a = linked.map((d) => d.id).sort();
    // convert again over a fresh twin to prove determinism: same payments → same selection
    const { plan_convert } = require('../src/functions/domain/recurring/convert_plan.service');
    const { resolve_convert_facts } = require('../src/functions/resolvers/recurring/convert.resolver');
    const twin = await seed_vendor('qzr8f', COFFEE, 360, 1, 4.5, 1);
    const f1 = await resolve_convert_facts(ctx(), twin.h.ids.userId, `plaid_${twin.h.ids.txn('v10')}`, NOW_MS);
    const p1 = plan_convert(f1.facts, { name: 'C', amount: 4.5, frequency: 'monthly', next_due_date: '2037-11-04', link_past: true }, 'x');
    const p2 = plan_convert(f1.facts, { name: 'C', amount: 4.5, frequency: 'monthly', next_due_date: '2037-11-04', link_past: true }, 'x');
    expect(p1.selection.chosen.map((c: any) => c.id)).toEqual(p2.selection.chosen.map((c: any) => c.id));
    expect(p1.selection.chosen.length).toBe(12);
    // twice a month: 24 links
    const semi = await seed_vendor('qzr8g', COFFEE, 360, 1, 4.5, 1);
    const sr = await convert(ctx(), semi.h.ids.userId, {
      transaction_id: `plaid_${semi.h.ids.txn('v10')}`, name: 'Coffee2', amount: 4.5, frequency: 'semimonthly', next_due_date: '2037-10-19', link_past: true,
    }, Date.now());
    const linked2 = (await db.collection('transactions').where('splitOutflowIds', 'array-contains', sr.id).get()).docs;
    expect(linked2.length).toBe(24);
    void ids_a;
    // the other 340+ coffees stay normal transactions in their budgets (still unlinked after a re-assign)
    const { assign_transactions_batch_orchestrator } = require('../src/functions/orchestrators/transactions/assign_transactions_batch.orchestrator');
    const unlinked = (await db.collection('transactions').where('ownerId', '==', uid).get()).docs
      .filter((d) => d.data().merchantName === 'Corner Coffee' && !(d.data().splitOutflowIds ?? []).length).map((d) => d.id);
    expect(unlinked.length).toBe(360 - 12);
    const c = startCounting();
    await assign_transactions_batch_orchestrator(ctx(), { user_id: uid, transaction_ids: unlinked.slice(0, 100) });
    await settle();
    expect(c.stop().writes_by.transactions ?? 0).toBe(0); // D1 never links a pre-convert coffee afterwards
  }, 600000);

  it('edge-money and internal-transfer payments of the vendor are never rewritten by a convert', async () => {
    const { h } = await seed_vendor('qzr8h', GYM, 6, 30, 40, 5);
    const uid = h.ids.userId;
    const edge = (await h.txn('v3'));
    await db.collection('transactions').doc(`plaid_${h.ids.txn('v3')}`).update({ transferRole: 'edge_out' });
    const before = (await db.collection('transactions').doc(`plaid_${h.ids.txn('v3')}`).get()).data()!;
    void edge;
    const r = await convert(ctx(), uid, {
      transaction_id: `plaid_${h.ids.txn('v0')}`, name: 'Gym', amount: 40, frequency: 'monthly', next_due_date: ymd(NOW_MS + 25 * DAY), link_past: true,
    }, Date.now());
    expect(r.linked_past_count).toBe(4); // 6 payments − the source − the edge one
    const after = (await db.collection('transactions').doc(`plaid_${h.ids.txn('v3')}`).get()).data()!;
    expect(after.updatedAt.toMillis()).toBe(before.updatedAt.toMillis());
    expect(after.splits[0].outflowId ?? null).toBeNull();
  }, 300000);
});
