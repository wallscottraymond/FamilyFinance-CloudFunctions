/**
 * Emulator — fix round 5: whole-doc writers built from a stale read (removal intervals, hide,
 * soft delete, stale-marking) can't wipe the convert-lifecycle markers; a user can recover from
 * CONVERT_FAILED by removing the bill and converting again; periods a resume creates are
 * suppressed by the record's pause.
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern fixRound5"
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
let convert: any; let manage: any; let outflow_repo: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  require('../src/functions/orchestrators/periods/derive_period.orchestrator');
  ({ convert_transaction_to_recurring_orchestrator: convert } = require('../src/functions/orchestrators/recurring/convert_transaction_to_recurring.orchestrator'));
  ({ manage_recurring_removal_orchestrator: manage } = require('../src/functions/orchestrators/recurring/manage_recurring_removal.orchestrator'));
  ({ outflow_repo } = require('../src/functions/repositories/outflow.repo'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const DAY = 86400000;
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const ago = (y: number, m: number, d: number) => Math.round((Date.UTC(2037, 9, 15) - Date.UTC(y, m - 1, d)) / DAY);
const ll = (ids: Parameters<typeof plaidTxn>[0], key: string, days_ago: number, o: Record<string, unknown> = {}) => ({
  ...plaidTxn(ids, { key, account: 'chk', amount: 1500, days_ago, name: 'LANDLORD LLC', merchant: 'Landlord LLC', primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_RENT' }), ...o,
});
const RENT = { name: 'Rent', amount: 1500, frequency: 'monthly', next_due_date: '2037-11-03', link_past: true };
const doc = (h: any, k: string) => `plaid_${h.ids.txn(k)}`;
async function fresh_rent(tag: string) {
  const h = await makeHarness(db, tag, mocks, { flag: true });
  await h.sync('link');
  h.postTxns([ll(h.ids, 'oct', ago(2037, 10, 3)), ll(h.ids, 'sep', ago(2037, 9, 3)), ll(h.ids, 'aug', ago(2037, 8, 3))]);
  await h.sync('rent');
  return h;
}
const bill_of = async (uid: string) => (await db.collection('outflows').where('ownerId', '==', uid).where('vendorKey', '==', 'landlord llc').get()).docs;
const gen = () => require('../src/functions/orchestrators/outflows/generate_outflow_periods.orchestrator');


describe('fix round 5 (emulator)', () => {
  it('1: a pause (set_removal_intervals) landing mid-convert cannot wipe or roll back the lifecycle markers', async () => {
    const h = await fresh_rent('qzj1');
    await convert(ctx(), h.ids.userId, { transaction_id: doc(h, 'oct'), ...RENT }, NOW_MS);
    const [b] = await bill_of(h.ids.userId);
    const before = (await b.ref.get()).data()!;
    expect(before.followUpsDoneAtMs).toBeGreaterThan(0);
    // The writer reads the doc, THEN the convert stamps newer markers, THEN the writer writes.
    const proto = admin.firestore.DocumentReference.prototype as any;
    const orig = proto.get;
    let armed = true;
    proto.get = async function (this: any, ...a: any[]) {
      const snap = await orig.apply(this, a);
      if (armed && this.path === `outflows/${b.id}`) {
        armed = false;
        await this.update({ retroLinkedAtMs: 111, followUpsDoneAtMs: 222, convertAttempts: 2, resumeLeaseMs: 333 });
      }
      return snap;
    };
    try {
      await outflow_repo.set_removal_intervals(ctx(), b.id, [{ from_ms: NOW_MS, to_ms: NOW_MS + 30 * DAY, mode: 'paused' }], false, h.ids.userId);
    } finally { proto.get = orig; }
    const after = (await b.ref.get()).data()!;
    expect([after.retroLinkedAtMs, after.followUpsDoneAtMs, after.convertAttempts, after.resumeLeaseMs]).toEqual([111, 222, 2, 333]);
    expect(after.removalIntervals).toHaveLength(1); // the pause itself landed
    // a doc without markers is written exactly as before
    const { without_lifecycle_markers } = require('../src/functions/repositories/convert_doc_fields');
    expect(without_lifecycle_markers({ a: 1 }, { a: 1, b: 2 })).toEqual({ data: { a: 1, b: 2 }, merge: false });
  }, 300000);

  it('2: after CONVERT_FAILED, removing the stuck bill lets the next convert of the same transaction succeed', async () => {
    const h = await fresh_rent('qzj2');
    const spy = jest.spyOn(gen(), 'generate_outflow_periods_orchestrator').mockResolvedValue({ success: false, periods_created: 0, errors: ['boom'], trace_id: 't' });
    const req = { transaction_id: doc(h, 'oct'), ...RENT };
    for (let i = 0; i < 3; i++) expect((await convert(ctx(), h.ids.userId, req, NOW_MS)).in_progress).toBe(true);
    expect((await convert(ctx(), h.ids.userId, req, NOW_MS).catch((e: any) => e)).code).toBe('CONVERT_FAILED');
    spy.mockRestore();
    const [stuck] = await bill_of(h.ids.userId);
    await manage(ctx(), h.ids.userId, [], { id: stuck.id, action: 'remove', mode: 'all' }, NOW_MS, outflow_repo, 'recurring_outflow');
    const ok = await convert(ctx(), h.ids.userId, req, NOW_MS);
    expect(ok.in_progress).toBeUndefined();
    expect(ok.id).not.toBe(stuck.id);
    expect((await db.collection('outflows').doc(stuck.id).get()).exists).toBe(false);
    const bills = await bill_of(h.ids.userId);
    expect(bills).toHaveLength(1);
    expect(bills[0].data().retroLinkedAtMs).toBeGreaterThan(0);
  }, 400000);

  it('3: periods a resume creates inside a pause that landed meanwhile are suppressed', async () => {
    const h = await fresh_rent('qzj3');
    const spy = jest.spyOn(gen(), 'generate_outflow_periods_orchestrator').mockResolvedValue({ success: false, periods_created: 0, errors: ['boom'], trace_id: 't' });
    expect((await convert(ctx(), h.ids.userId, { transaction_id: doc(h, 'oct'), ...RENT }, NOW_MS)).in_progress).toBe(true);
    spy.mockRestore();
    const [b] = await bill_of(h.ids.userId);
    expect((await db.collection('outflow_periods').where('outflowId', '==', b.id).get()).size).toBe(0); // none created yet
    await manage(ctx(), h.ids.userId, [], { id: b.id, action: 'pause', resume_ms: NOW_MS + 90 * DAY }, NOW_MS, outflow_repo, 'recurring_outflow');
    await convert(ctx(), h.ids.userId, { transaction_id: doc(h, 'oct'), ...RENT }, NOW_MS);
    const periods = (await db.collection('outflow_periods').where('outflowId', '==', b.id).get()).docs.map((d) => d.data());
    const inside = periods.filter((p) => p.periodEndDate.toMillis() >= Date.UTC(2037, 9, 1) && p.periodEndDate.toMillis() < NOW_MS + 90 * DAY);
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.filter((p) => p.isActive !== false)).toHaveLength(0);
    expect(periods.some((p) => p.isActive !== false)).toBe(true); // outside the pause stays active
  }, 300000);
});
