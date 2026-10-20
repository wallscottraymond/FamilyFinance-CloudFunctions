/**
 * Emulator — fix round 5: whole-doc writers built from a stale read (removal intervals, hide,
 * soft delete, stale-marking) can't wipe the convert-lifecycle markers; a user can recover from
 * CONVERT_FAILED by deleting the bill (D47) and converting again; periods a resume creates are
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
let convert: any; let manage: any; let outflow_repo: any; let inflow_repo: any; let preview: any; let reassign: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  require('../src/functions/orchestrators/periods/derive_period.orchestrator');
  ({ convert_transaction_to_recurring_orchestrator: convert } = require('../src/functions/orchestrators/recurring/convert_transaction_to_recurring.orchestrator'));
  ({ manage_recurring_removal_orchestrator: manage } = require('../src/functions/orchestrators/recurring/manage_recurring_removal.orchestrator'));
  ({ outflow_repo } = require('../src/functions/repositories/outflow.repo'));
  ({ inflow_repo } = require('../src/functions/repositories/inflow.repo'));
  ({ preview_convert_transaction_orchestrator: preview } = require('../src/functions/orchestrators/recurring/preview_convert_transaction.orchestrator'));
  ({ reassign_user_orchestrator: reassign } = require('../src/functions/orchestrators/transactions/reassign_user.orchestrator'));
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

describe('fix round 8 (emulator): CONVERT_FAILED is recovered by Delete, then a fresh convert (D47)', () => {
  type Kind = 'outflow' | 'inflow';
  const setup = async (tag: string, kind: Kind) => {
    const h = await makeHarness(db, tag, mocks, { flag: true });
    await h.sync('link');
    const dep = (key: string, days_ago: number) => kind === 'inflow'
      ? plaidTxn(h.ids, { key, account: 'chk', amount: -450, days_ago, name: 'SIDE GIG CO', merchant: 'Side Gig Co', primary: 'INCOME', detailed: 'INCOME_OTHER_INCOME' })
      : ll(h.ids, key, days_ago);
    h.postTxns([dep('oct', ago(2037, 10, 3)), dep('sep', ago(2037, 9, 3)), dep('aug', ago(2037, 8, 3))]);
    await h.sync('pay');
    const req = kind === 'inflow'
      ? { transaction_id: doc(h, 'oct'), name: 'Side gig', amount: 450, frequency: 'monthly', next_due_date: '2037-11-03', link_past: true }
      : { transaction_id: doc(h, 'oct'), ...RENT };
    const coll = kind === 'inflow' ? 'inflows' : 'outflows';
    const gmod = require(`../src/functions/orchestrators/${kind}s/generate_${kind}_periods.orchestrator`);
    const spy = jest.spyOn(gmod, `generate_${kind}_periods_orchestrator`).mockResolvedValue({ success: false, periods_created: 0, errors: ['boom'], trace_id: 't' });
    for (let i = 0; i < 3; i++) expect((await convert(ctx(), h.ids.userId, req, NOW_MS)).in_progress).toBe(true);
    const failed = await convert(ctx(), h.ids.userId, req, NOW_MS).catch((e: any) => e);
    spy.mockRestore();
    expect(failed.code).toBe('CONVERT_FAILED');
    expect(failed.message).toContain(kind === 'inflow' ? `Delete it from your income, then tap "Make this income" again.` : `Delete it from your bills, then tap "Make this a bill" again.`);
    const stuck = (await db.collection(coll).where('ownerId', '==', h.ids.userId).where('convertedFromTxnId', '==', doc(h, 'oct')).get()).docs[0];
    return { h, req, stuck, coll, repo: kind === 'inflow' ? inflow_repo : outflow_repo, etype: kind === 'inflow' ? 'recurring_inflow' : 'recurring_outflow' };
  };
  const nothing_references = async (uid: string, id: string) => {
    const s = await db.collection('transactions').where('userId', '==', uid).get();
    return s.docs.filter((d) => JSON.stringify(d.data()).includes(id)).map((d) => d.id);
  };
  const run_reassign = async (uid: string) => reassign(ctx(), { user_id: uid, reason: 'recurring_removal' });
  const finish = async (c: any, kind: Kind) => {
    await run_reassign(c.h.ids.userId);
    expect(await nothing_references(c.h.ids.userId, c.stuck.id)).toEqual([]); // links AND parked pins cleared
    const ok = await convert(ctx(), c.h.ids.userId, c.req, NOW_MS);
    expect(ok.in_progress).toBeUndefined();
    expect(ok.id).not.toBe(c.stuck.id);
    expect(ok.linked_past_count).toBeGreaterThan(0);
    const link = kind === 'inflow' ? 'inflowId' : 'outflowId';
    for (const k of ['oct', 'sep', 'aug']) expect((await c.h.txn(k)).splits[0][link]).toBe(ok.id);
    expect(await nothing_references(c.h.ids.userId, c.stuck.id)).toEqual([]);
    expect((await c.stuck.ref.get()).exists).toBe(false);
    const rec = (await db.collection(c.coll).doc(ok.id).get()).data()!;
    expect(rec.retroLinkedAtMs).toBeGreaterThan(0);
    // the bill's OWN vendor is no longer "Not a bill"
    const state = (await db.collection('_recurring_review_state').doc(c.h.ids.userId).get()).data() ?? {};
    return { ok, state };
  };

  it('outflow: CONVERT_FAILED -> delete -> reassign -> convert succeeds, nothing references the old id', async () => {
    const c = await setup('qzm1', 'outflow');
    await manage(ctx(), c.h.ids.userId, [], { id: c.stuck.id, action: 'delete' }, NOW_MS, c.repo, c.etype);
    await finish(c, 'outflow');
  }, 600000);

  it('income: CONVERT_FAILED -> delete -> reassign -> convert succeeds, nothing references the old id', async () => {
    const c = await setup('qzm2', 'inflow');
    expect((await c.h.txn('oct')).splits[0].inflowAssignmentSource).toBe('manual'); // the source's pin
    await manage(ctx(), c.h.ids.userId, [], { id: c.stuck.id, action: 'delete' }, NOW_MS, c.repo, c.etype);
    await finish(c, 'inflow');
  }, 600000);

  for (const mode of ['going_forward', 'all'] as const) {
    it(`outflow removed (${mode}) first, then deleted: recovery is the same, no parked pin survives`, async () => {
      const c = await setup(`qzm3${mode.slice(0, 2)}`, 'outflow');
      const extra = plaidTxn(c.h.ids, { key: 'gym', account: 'chk', amount: 60, days_ago: ago(2037, 10, 5), name: 'GYM CO', merchant: 'Gym Co', primary: 'GENERAL_SERVICES', detailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES' });
      c.h.postTxns([extra]);
      await c.h.sync('gym');
      const { transaction_repo } = require('../src/functions/repositories/transaction.repo');
      const g = await c.h.txn('gym');
      await transaction_repo.pin_split_to_outflow(ctx(), doc(c.h, 'gym'), g.splits[0].splitId, c.stuck.id, c.h.ids.userId); // a manual pin to the stuck bill
      await manage(ctx(), c.h.ids.userId, [], { id: c.stuck.id, action: 'remove', mode }, NOW_MS, c.repo, c.etype);
      await run_reassign(c.h.ids.userId); // the removal's own re-assign parks the pin
      expect(await nothing_references(c.h.ids.userId, c.stuck.id)).toContain(doc(c.h, 'gym')); // parked, so the check below bites
      await manage(ctx(), c.h.ids.userId, [], { id: c.stuck.id, action: 'delete' }, NOW_MS, c.repo, c.etype);
      await finish(c, 'outflow');
    }, 600000);
  }

  it('a removed, unfinished conversion: preview and convert give the SAME refusal', async () => {
    const c = await setup('qzm4', 'outflow');
    await manage(ctx(), c.h.ids.userId, [], { id: c.stuck.id, action: 'remove', mode: 'all' }, NOW_MS, c.repo, c.etype);
    await c.stuck.ref.update({ resumeLeaseMs: 0 });
    const pv = await preview(ctx(), c.h.ids.userId, { transaction_id: doc(c.h, 'oct') }, NOW_MS);
    const cv = await convert(ctx(), c.h.ids.userId, c.req, NOW_MS).catch((e: any) => e);
    expect(pv.refusal.code).toBe('ALREADY_TRACKED');
    expect(cv.code).toBe('ALREADY_TRACKED');
    expect(pv.refusal.message).toBe(cv.message);
    expect(pv.refusal.details).toEqual(cv.details);
    expect((await c.stuck.ref.get()).exists).toBe(true); // nothing was discarded
  }, 600000);

  it('an absorbed vendor\'s earlier "Not a bill" survives the recovery; the bill\'s own vendor is cleared', async () => {
    const c = await setup('qzm5', 'outflow');
    await c.stuck.ref.update({
      absorbedStreams: [{ streamId: 'sx', state: 'absorbed', atMs: 1, txnIds: ['p1'], vendorKey: 'll properties' }], absorbedTxnIds: ['p1'],
    });
    await manage(ctx(), c.h.ids.userId, [], { id: c.stuck.id, action: 'delete' }, NOW_MS, c.repo, c.etype);
    let state = (await db.collection('_recurring_review_state').doc(c.h.ids.userId).get()).data()!;
    expect([...state.dismissedVendorKeys].sort()).toEqual(['outflow:landlord llc', 'outflow:ll properties']);
    const r = await finish(c, 'outflow');
    state = r.state as any;
    expect(state.dismissedVendorKeys).toContain('outflow:ll properties'); // D11: absorbed vendor stays dismissed
    expect(state.dismissedVendorKeys ?? []).not.toContain('outflow:landlord llc'); // own vendor cleared by step 7
  }, 600000);

  // Round 9: a stuck record that already HAS periods (an attempt that got past period generation).
  const with_periods = async (c: any, kind: Kind) => {
    const { generate_periods_inline } = require('../src/functions/orchestrators/recurring/generate_periods_inline');
    const rec = (await c.stuck.ref.get()).data()!;
    await generate_periods_inline(ctx(), c.h.ids.userId, [{ id: c.stuck.id, kind, created: true, before: null, after: rec }], true);
    const pcoll = kind === 'inflow' ? 'inflow_periods' : 'outflow_periods';
    const pfield = kind === 'inflow' ? 'inflowId' : 'outflowId';
    const periods = () => db.collection(pcoll).where(pfield, '==', c.stuck.id).get();
    expect((await periods()).size).toBeGreaterThan(0); // so the checks below bite
    return periods;
  };

  for (const kind of ['outflow', 'inflow'] as const) {
    it(`round 9 (${kind}): Delete removes the stuck record's periods, so its payments can't be pulled back to it`, async () => {
      const c = await setup(`qzn1${kind.slice(0, 2)}`, kind);
      const periods = await with_periods(c, kind);
      await manage(ctx(), c.h.ids.userId, [], { id: c.stuck.id, action: 'delete' }, NOW_MS, c.repo, c.etype);
      expect((await periods()).size).toBe(0);
      await finish(c, kind);
      await run_reassign(c.h.ids.userId); // a later re-assign keeps them on the new record
      const link = kind === 'inflow' ? 'inflowId' : 'outflowId';
      const [rec] = (await db.collection(c.coll).where('ownerId', '==', c.h.ids.userId).where('convertedFromTxnId', '==', doc(c.h, 'oct')).get()).docs;
      for (const k of ['oct', 'sep', 'aug']) expect((await c.h.txn(k)).splits[0][link]).toBe(rec.id);
      expect(await nothing_references(c.h.ids.userId, c.stuck.id)).toEqual([]);
    }, 600000);

    it(`round 9 (${kind}): converting again right after Delete (re-assign not yet run) still links the past payments`, async () => {
      const c = await setup(`qzn2${kind.slice(0, 2)}`, kind);
      await with_periods(c, kind);
      const link = kind === 'inflow' ? 'inflowId' : 'outflowId';
      // the stuck record had linked the earlier payments
      await run_reassign(c.h.ids.userId);
      expect((await c.h.txn('sep')).splits[0][link]).toBe(c.stuck.id);
      await manage(ctx(), c.h.ids.userId, [], { id: c.stuck.id, action: 'delete' }, NOW_MS, c.repo, c.etype);
      const pv = await preview(ctx(), c.h.ids.userId, { transaction_id: doc(c.h, 'oct') }, NOW_MS);
      const ok = await convert(ctx(), c.h.ids.userId, c.req, NOW_MS); // no re-assign in between
      expect(ok.in_progress).toBeUndefined();
      expect(ok.id).not.toBe(c.stuck.id);
      expect(ok.linked_past_count).toBeGreaterThan(0);
      expect(ok.linked_past_count).toBe(pv.linkable_count);
      for (const k of ['oct', 'sep', 'aug']) expect((await c.h.txn(k)).splits[0][link]).toBe(ok.id);
      await run_reassign(c.h.ids.userId); // the delete's own re-assign, arriving late
      for (const k of ['oct', 'sep', 'aug']) expect((await c.h.txn(k)).splits[0][link]).toBe(ok.id);
      expect(await nothing_references(c.h.ids.userId, c.stuck.id)).toEqual([]);
    }, 600000);
  }

  it('round 9: a removed, unfinished INCOME conversion is refused with income wording', async () => {
    const c = await setup('qzn3', 'inflow');
    await manage(ctx(), c.h.ids.userId, [], { id: c.stuck.id, action: 'remove', mode: 'all' }, NOW_MS, c.repo, c.etype);
    await c.stuck.ref.update({ resumeLeaseMs: 0 });
    const pv = await preview(ctx(), c.h.ids.userId, { transaction_id: doc(c.h, 'oct') }, NOW_MS);
    const cv = await convert(ctx(), c.h.ids.userId, c.req, NOW_MS).catch((e: any) => e);
    expect(cv.code).toBe('ALREADY_TRACKED');
    expect(cv.message).toBe('This was already made into income');
    expect(pv.refusal.message).toBe(cv.message);
  }, 600000);
});
