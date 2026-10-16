/**
 * Emulator — Phase 1 extras + Top-25 #20 / #24 (review round 3). 2037 scenario clock (Oct 15);
 * weekly / twice-a-month periods are in-process only (helpers/syntheticPeriods).
 *
 *   #20  v2 states in weekly + twice-a-month views: a Plaid-inactive "Still a bill?" bill stays
 *        expected; a suggestion stays out of the totals AND the Everything-Else leftover.
 *   #24  F13: a v2 bill's payment from ANOTHER account is not auto-linked and raises no "Same bill?"
 *        in Phase 1 (expected outcome: it is ordinary spending; the user can pin it).
 *   extras: TOMBSTONED v2 stream returning MATURE under a new id; Plaid reusing a v2 stream id;
 *        flag-on first link with 20 ended streams (weekly + twice-a-month); X17 income on a credit
 *        account; edge-money held-out payments; Mark as paid on a Plaid-inactive v2 occurrence;
 *        override + rename survive "It ended" and later syncs; restoring a pending "It ended" in
 *        weekly view leaves no gap; one vendor as both a bill and income → 2 items; the answer
 *        callable refuses same_bill (Phase 2) and enforces the bill owner on keep_separate.
 */
import * as admin from 'firebase-admin';
import { FAKE_CLOCK, OCT, NOV, makeHarness, paidTotal, plaidTxn, scenarioRecurring, seedMonths } from './helpers/captureHarness';
import { NOW_MS, plaidStream } from './helpers/captureScenario';
import { synthetic, withSyntheticPeriods } from './helpers/syntheticPeriods';
import { make_review_item } from '../src/functions/domain/recurring/review_item.service';

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
let derive: any;
let answer: any;
let manage: any;
let settle: any;
let outflow_repo: any;
let recurring_review_repo: any;
let account_repo: any;
let sharing: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  ({ derive_period_orchestrator: derive } = require('../src/functions/orchestrators/periods/derive_period.orchestrator'));
  ({ answer_recurring_review_item_orchestrator: answer } = require('../src/functions/orchestrators/recurring/answer_recurring_review_item.orchestrator'));
  ({ manage_recurring_removal_orchestrator: manage } = require('../src/functions/orchestrators/recurring/manage_recurring_removal.orchestrator'));
  ({ set_occurrence_settled_orchestrator: settle } = require('../src/functions/orchestrators/recurring/set_occurrence_settled.orchestrator'));
  ({ outflow_repo } = require('../src/functions/repositories/outflow.repo'));
  ({ recurring_review_repo } = require('../src/functions/repositories/recurring_review.repo'));
  ({ account_repo } = require('../src/functions/repositories/account.repo'));
  sharing = {
    ...require('../src/functions/orchestrators/sharing/connect.orchestrator'),
    ...require('../src/functions/orchestrators/sharing/connections.orchestrator'),
    ...require('../src/functions/orchestrators/sharing/groups.orchestrator'),
  };
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const octx = <T>(user_id: string, input: T) => ({ ...ctx(), user_id, input, idempotency_key: `k_${Math.random()}` });
const SYN = synthetic(Date.UTC(2037, 8, 27), Date.UTC(2037, 11, 6), 'PX');
const CADENCES = ['monthly', 'weekly', 'bi_monthly'];
const view = (uid: string, cadence: string, w: { start: number; end: number }, scope?: any): Promise<any> =>
  withSyntheticPeriods(SYN, () => derive(ctx(), uid, {
    view_cadence: cadence, window_start_ms: w.start, window_end_ms: w.end, force: true, ...(scope ? { scope } : {}),
  }));
/** The bill's occurrences due INSIDE the window (weekly buckets reach past a month's edges). */
const occ = (r: any, id: string, w?: { start: number; end: number }) => (r.bills.find((b: any) => b.recurring_id === id)?.groups ?? [])
  .flatMap((g: any) => g.occurrences)
  .filter((o: any) => !w || (o.due_ms >= w.start && o.due_ms <= w.end))
  .map((o: any) => [new Date(o.due_ms).toISOString().slice(0, 10), o.paid]);
const itemsOf = async (uid: string) =>
  (await db.collection('recurring_review_items').where('userId', '==', uid).get()).docs.map((d) => d.data());
const spotify = (ids: any, key: string, days_ago: number, account: 'chk' | 'card' = 'chk', amount = 15.49) =>
  plaidTxn(ids, { key, account, amount, days_ago, name: 'SPOTIFY USA', merchant: 'Spotify', primary: 'ENTERTAINMENT', detailed: 'ENTERTAINMENT_MUSIC_AND_AUDIO' });
const linked = (r: any, doc: string) =>
  r.bills.filter((b: any) => b.groups.some((g: any) => g.occurrences.some((o: any) => o.transaction_id === doc))).map((b: any) => b.recurring_id);

describe('Phase 1 extras (emulator)', () => {
  it('#20 weekly + twice-a-month: a Plaid-inactive "Still a bill?" bill stays expected; a suggestion stays out of totals + EE leftover', async () => {
    const a = await makeHarness(db, 'qzx20a', mocks, { flag: true });
    a.setRecurring(scenarioRecurring(a.ids, { SPOT: { is_active: false } }));
    await a.sync('link');
    await a.sync('again');
    // Twin without the Sunbit stream at all (same transactions).
    const b = await makeHarness(db, 'qzx20b', mocks, { flag: true });
    const rb = scenarioRecurring(b.ids, { SPOT: { is_active: false } });
    b.setRecurring({ ...rb, outflow_streams: rb.outflow_streams.filter((s: any) => s.stream_id !== b.ids.streams.SUNBIT) });
    await b.sync('link');
    await b.sync('again');
    // Spotify was first seen inactive under v2 rules? No — it was created active at link (v2) and is Plaid-inactive now.
    const items = await itemsOf(a.ids.userId);
    expect(items.some((i) => i.vendorKey === 'sunbit' && i.status === 'open')).toBe(true);
    for (const c of CADENCES) {
      const ra = await view(a.ids.userId, c, NOV);
      const rbv = await view(b.ids.userId, c, NOV);
      // Sunbit (suggested) is in no bill list / total; the EE leftover per bucket equals the twin's.
      expect(ra.bills.some((x: any) => x.recurring_id === a.ids.streams.SUNBIT)).toBe(false);
      const ee = (r: any) => r.budgets.filter((x: any) => x.is_everything_else).flatMap((x: any) => x.periods)
        .map((p: any) => [p.period_id, p.allocated_amount, p.effective_amount]);
      expect({ c, ee: ee(ra) }).toEqual({ c, ee: ee(rbv) });
    }
  }, 240000);

  it('#20 (still a bill) — the Plaid-inactive v2 bill keeps its November occurrence in every cadence', async () => {
    const h = await makeHarness(db, 'qzx20c', mocks, { flag: true });
    await h.sync('link');
    const SPOT = h.ids.streams.SPOT;
    h.setRecurring(scenarioRecurring(h.ids, { SPOT: { is_active: false } }));
    await h.sync('off');
    expect((await itemsOf(h.ids.userId)).some((i) => i.kind === 'still_a_bill' && i.recordId === SPOT && i.status === 'open')).toBe(true);
    const expected: Record<string, unknown> = {};
    for (const c of CADENCES) expected[c] = occ(await view(h.ids.userId, c, NOV), SPOT, NOV);
    expect(expected.monthly).toHaveLength(1);
    expect((expected.monthly as any[])[0][1]).toBe(false); // expected, unpaid
    expect(expected.weekly).toEqual(expected.monthly);
    expect(expected.bi_monthly).toEqual(expected.monthly);
  }, 240000);

  it('#24 F13: a v2 bill\'s payment from another account is not auto-linked and raises no "Same bill?"', async () => {
    const h = await makeHarness(db, 'qzx24', mocks, { flag: true });
    await h.sync('link');
    const SPOT = h.ids.streams.SPOT;
    h.postTxns([spotify(h.ids, 'oncard', 0, 'card')]);
    await h.sync('card_payment');
    const t = await h.txn('oncard');
    expect(t?.splits[0].outflowId ?? null).toBeNull(); // Phase 1: ordinary spending (pin it to link)
    expect((await itemsOf(h.ids.userId)).filter((i) => i.kind === 'same_bill')).toEqual([]);
    for (const c of CADENCES) expect(linked(await view(h.ids.userId, c, OCT), `plaid_${h.ids.txn('oncard')}`)).toEqual([]);
    expect(paidTotal(await h.bill(OCT, SPOT))).toBe(15.49); // still paid once by its own Oct 5 payment
  }, 180000);

  it('extra: a TOMBSTONED v2 stream returns MATURE under a new id → kept + asked, the new one held as "Same bill?"', async () => {
    const h = await makeHarness(db, 'qzxtomb', mocks, { flag: true });
    await h.sync('link');
    const SPOT = h.ids.streams.SPOT;
    h.ids.streams.SPOT2 = `${h.ids.tag}_S_SPOT2`;
    const rec = scenarioRecurring(h.ids, { SPOT: { status: 'TOMBSTONED', is_active: false } });
    rec.outflow_streams.push(plaidStream(h.ids, 'SPOT2', {
      account: 'chk', keys: ['spotnew'], amount: 16.99, description: 'SPOTIFY USA', merchant: 'Spotify', primary: 'ENTERTAINMENT',
      detailed: 'ENTERTAINMENT_MUSIC_AND_AUDIO', frequency: 'MONTHLY', status: 'MATURE', is_active: true, first_days_ago: 1,
      last_days_ago: 1, next_days: 29,
    }));
    h.setRecurring(rec);
    h.postTxns([spotify(h.ids, 'spotnew', 1, 'chk', 16.99)]);
    await h.sync('switch');
    const old = (await db.collection('outflows').doc(SPOT).get()).data()!;
    expect([old.captureRulesVersion, old.isActive, old.plaidIsActive]).toEqual([2, true, false]); // X10: kept
    expect((await db.collection('outflows').doc(h.ids.streams.SPOT2).get()).exists).toBe(false); // no second bill
    const items = await itemsOf(h.ids.userId);
    expect(items.filter((i) => i.kind === 'same_bill').map((i) => [i.recordId, i.streamId, i.status])).toEqual([[SPOT, h.ids.streams.SPOT2, 'open']]);
    const st = (await db.collection('_recurring_review_state').doc(h.ids.userId).get()).data()!;
    expect(st.suppressedTxnIds).toContain(h.ids.txn('spotnew')); // never double counted meanwhile
    expect((await view(h.ids.userId, 'monthly', NOV)).bills.filter((b: any) => b.recurring_id.includes('SPOT')).map((b: any) => b.recurring_id)).toEqual([SPOT]);
  }, 180000);

  it('extra: Plaid reuses a v2 stream id (new merchant / amount) → the same record, updated in place, edits kept', async () => {
    const h = await makeHarness(db, 'qzxreuse', mocks, { flag: true });
    await h.sync('link');
    const SPOT = h.ids.streams.SPOT;
    await db.collection('outflows').doc(SPOT).update({ userCustomName: 'My Music' });
    const before_count = (await db.collection('outflows').where('ownerId', '==', h.ids.userId).get()).size;
    const rec = scenarioRecurring(h.ids);
    const i = rec.outflow_streams.findIndex((s: any) => s.stream_id === SPOT);
    rec.outflow_streams[i] = { ...rec.outflow_streams[i], merchant_name: 'Spotify Family', description: 'SPOTIFY FAMILY',
      average_amount: { amount: 19.99, iso_currency_code: 'USD' }, last_amount: { amount: 19.99, iso_currency_code: 'USD' },
      transaction_ids: [...rec.outflow_streams[i].transaction_ids, h.ids.txn('fam0')] };
    h.setRecurring(rec);
    h.postTxns([{ ...spotify(h.ids, 'fam0', 0, 'chk', 19.99), merchant_name: 'Spotify Family', name: 'SPOTIFY FAMILY' }]);
    await h.sync('reused');
    const o = (await db.collection('outflows').doc(SPOT).get()).data()!;
    expect([o.captureRulesVersion, o.userCustomName, o.merchantName, o.averageAmount, o.isActive]).toEqual([2, 'My Music', 'Spotify Family', 19.99, true]);
    expect((await db.collection('outflows').where('ownerId', '==', h.ids.userId).get()).size).toBe(before_count);
    expect((await itemsOf(h.ids.userId)).filter((it) => it.recordId === SPOT || it.streamId === SPOT)).toEqual([]);
    expect((await h.txn('fam0'))?.splits[0].outflowId).toBe(SPOT);
  }, 180000);

  it('extra: flag-on first link with 20 ENDED streams → 0 active bills, 0 "Still a bill?", nothing in weekly / twice-a-month views', async () => {
    const h = await makeHarness(db, 'qzxended', mocks, { flag: true });
    const ended = Array.from({ length: 20 }, (_, n) => {
      const name = `END${n}`;
      h.ids.streams[name] = `${h.ids.tag}_S_${name}`;
      return plaidStream(h.ids, name, {
        account: 'chk', keys: [], amount: 10 + n, description: `OLD VENDOR ${n}`, merchant: `Old Vendor ${n}`, primary: 'GENERAL_SERVICES',
        detailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES', frequency: 'MONTHLY', status: 'MATURE', is_active: false,
        first_days_ago: 700, last_days_ago: 200 + n, next_days: null,
      });
    });
    const rec = scenarioRecurring(h.ids);
    h.setRecurring({ ...rec, outflow_streams: [...rec.outflow_streams, ...ended] });
    await h.sync('link');
    const ids = ended.map((s) => s.stream_id);
    const docs = await Promise.all(ids.map((id) => db.collection('outflows').doc(id).get()));
    expect(docs.filter((d) => d.data()?.isActive === true)).toHaveLength(0);
    expect(docs.filter((d) => d.data()?.captureRulesVersion === 2)).toHaveLength(0); // X2: today's handling
    expect((await itemsOf(h.ids.userId)).filter((i) => i.kind === 'still_a_bill')).toEqual([]);
    for (const c of CADENCES) {
      const r = await view(h.ids.userId, c, OCT);
      const shown = r.bills.filter((b: any) => ids.includes(b.recurring_id) && b.groups.some((g: any) => g.count_in_period > 0));
      expect({ c, shown: shown.length }).toEqual({ c, shown: 0 });
    }
  }, 180000);

  it('extra: X17 — an early income stream on a CREDIT account never becomes a suggestion (control: on checking it does)', async () => {
    const h = await makeHarness(db, 'qzx17', mocks, { flag: true });
    const inc = (name: string, account: 'card' | 'chk') => {
      h.ids.streams[name] = `${h.ids.tag}_S_${name}`;
      return plaidStream(h.ids, name, {
        account, keys: [], amount: -120, description: `REBATE ${name}`, merchant: `Rebate ${name}`, primary: 'INCOME',
        detailed: 'INCOME_OTHER_INCOME', frequency: 'MONTHLY', status: 'EARLY_DETECTION', is_active: true,
        first_days_ago: 40, last_days_ago: 10, next_days: 20,
      });
    };
    const rec = scenarioRecurring(h.ids);
    h.setRecurring({ ...rec, inflow_streams: [...rec.inflow_streams, inc('RCARD', 'card'), inc('RCHK', 'chk')] });
    await h.sync('link');
    const items = await itemsOf(h.ids.userId);
    expect(items.some((i) => i.streamId === h.ids.streams.RCARD)).toBe(false);
    expect(items.some((i) => i.streamId === h.ids.streams.RCHK && i.direction === 'inflow' && i.status === 'open')).toBe(true);
  }, 180000);

  it('extra: edge-money held-out payments stay out of every bill (Me + group view, every cadence)', async () => {
    const h = await makeHarness(db, 'qzxedge', mocks, { flag: true });
    const owner = h.ids.userId;
    const member = `${h.ids.tag}_member`;
    await db.collection('users').doc(member).set({ email: `${member}@x.com` });
    const ca = (await sharing.get_my_connect_code_orchestrator(octx(owner, { refresh: true }))).code;
    const cb = (await sharing.get_my_connect_code_orchestrator(octx(member, { refresh: true }))).code;
    await sharing.enter_connect_code_orchestrator(octx(owner, { code: cb }));
    await sharing.enter_connect_code_orchestrator(octx(member, { code: ca }));
    const group_id = (await sharing.create_group_orchestrator(octx(owner, { name: 'Home', invitee_ids: [member] }))).group_id;
    const req = (await sharing.get_sharing_overview_orchestrator(octx(member, {}))).requests[0];
    await sharing.respond_to_request_orchestrator(octx(member, { request_id: req.id, accept: true }));
    // Checking is shared, savings stays private: every checking → savings transfer leaves the group view (edge money).
    await account_repo.set_placement(ctx(), h.ids.chk, { group_id, shared_from_ms: null, shared_by: owner, shared_at_ms: NOW_MS }, owner);
    h.setRecurring(scenarioRecurring(h.ids, { XFER: { status: 'EARLY_DETECTION' } })); // unsure → held out
    await h.sync('link');
    const st = (await db.collection('_recurring_review_state').doc(owner).get()).data()!;
    expect(st.suppressedTxnIds).toContain(h.ids.txn('xferout0'));
    const doc = `plaid_${h.ids.txn('xferout0')}`;
    expect((await h.txn('xferout0'))?.splits[0].outflowId ?? null).toBeNull();
    for (const scope of [null, { kind: 'group', group_id }]) {
      for (const c of CADENCES) {
        expect({ scope: scope ? 'group' : 'me', c, linked: linked(await view(owner, c, OCT, scope), doc) })
          .toEqual({ scope: scope ? 'group' : 'me', c, linked: [] });
      }
    }
  }, 240000);

  it('extra: Mark as paid on a Plaid-inactive v2 occurrence → settled; the question and the bill are unchanged', async () => {
    const h = await makeHarness(db, 'qzxmark', mocks, { flag: true });
    await h.sync('link');
    const SPOT = h.ids.streams.SPOT;
    h.setRecurring(scenarioRecurring(h.ids, { SPOT: { is_active: false } }));
    await h.sync('off');
    const nov = occ(await view(h.ids.userId, 'monthly', NOV), SPOT, NOV);
    expect(nov).toHaveLength(1);
    await settle(ctx(), h.ids.userId, [], { kind: 'outflow', recurring_id: SPOT, due_date: nov[0][0], settled: true });
    for (const c of CADENCES) expect({ c, occ: occ(await view(h.ids.userId, c, NOV), SPOT, NOV) }).toEqual({ c, occ: [[nov[0][0], true]] });
    const o = (await db.collection('outflows').doc(SPOT).get()).data()!;
    expect([o.isActive, o.plaidIsActive, o.captureRulesVersion]).toEqual([true, false, 2]);
    expect((await itemsOf(h.ids.userId)).filter((i) => i.kind === 'still_a_bill' && i.recordId === SPOT).map((i) => i.status)).toEqual(['open']);
    await h.sync('after_mark');
    expect(occ(await view(h.ids.userId, 'monthly', NOV), SPOT, NOV)).toEqual([[nov[0][0], true]]);
  }, 180000);

  it('extra: the expected-amount override and the rename survive "It ended" and later v2 syncs', async () => {
    const h = await makeHarness(db, 'qzxkeep', mocks, { flag: true });
    await h.sync('link');
    const SPOT = h.ids.streams.SPOT;
    await db.collection('outflows').doc(SPOT).update({ userCustomName: 'My Music', expectedAmountOverride: 20 });
    await manage(ctx(), h.ids.userId, [], { id: SPOT, action: 'end' }, NOW_MS, outflow_repo, 'recurring_outflow');
    for (let n = 0; n < 3; n++) await h.sync(`re${n}`);
    const o = (await db.collection('outflows').doc(SPOT).get()).data()!;
    expect([o.userCustomName, o.expectedAmountOverride, o.captureRulesVersion, o.removalIntervals.length]).toEqual(['My Music', 20, 2, 1]);
    const r = await view(h.ids.userId, 'monthly', OCT);
    const b = r.bills.find((x: any) => x.recurring_id === SPOT);
    expect(b.name).toBe('My Music');
    expect(occ(r, SPOT)).toEqual([[expect.any(String), true]]); // October kept (paid Oct 5)
    expect(occ(await view(h.ids.userId, 'monthly', NOV), SPOT)).toEqual([]); // ended
  }, 180000);

  it('extra: restoring a pending "It ended" in weekly view leaves no gap', async () => {
    const h = await makeHarness(db, 'qzxpend', mocks, { flag: true });
    await h.sync('link');
    const SPOT = h.ids.streams.SPOT;
    const before = { oct: occ(await view(h.ids.userId, 'weekly', OCT), SPOT, OCT), nov: occ(await view(h.ids.userId, 'weekly', NOV), SPOT, NOV) };
    expect(before.nov).toHaveLength(1);
    await manage(ctx(), h.ids.userId, [], { id: SPOT, action: 'end' }, NOW_MS, outflow_repo, 'recurring_outflow'); // paid Oct 5 → ends Nov 1
    expect(occ(await view(h.ids.userId, 'weekly', NOV), SPOT, NOV)).toEqual([]);
    await manage(ctx(), h.ids.userId, [], { id: SPOT, action: 'restore' }, NOW_MS, outflow_repo, 'recurring_outflow');
    const o = (await db.collection('outflows').doc(SPOT).get()).data()!;
    expect(o.removalIntervals).toEqual([]); // the not-yet-started end is simply cancelled
    expect({ oct: occ(await view(h.ids.userId, 'weekly', OCT), SPOT, OCT), nov: occ(await view(h.ids.userId, 'weekly', NOV), SPOT, NOV) }).toEqual(before);
    const periods = (await db.collection('outflow_periods').where('outflowId', '==', SPOT).get()).docs.map((d) => d.data());
    expect(periods.filter((p) => p.isActive === false)).toEqual([]);
  }, 180000);

  it('extra: the same vendor as both a bill and income → 2 separate items', async () => {
    const h = await makeHarness(db, 'qzxboth', mocks, { flag: true });
    const s = (name: string, direction: 'outflow' | 'inflow') => {
      h.ids.streams[name] = `${h.ids.tag}_S_${name}`;
      return plaidStream(h.ids, name, {
        account: 'chk', keys: [], amount: direction === 'outflow' ? 75 : -75, description: 'ZELLECO', merchant: 'ZelleCo',
        primary: direction === 'outflow' ? 'LOAN_PAYMENTS' : 'INCOME',
        detailed: direction === 'outflow' ? 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT' : 'INCOME_OTHER_INCOME',
        frequency: 'MONTHLY', status: 'EARLY_DETECTION', is_active: true, first_days_ago: 40, last_days_ago: 10, next_days: 20,
      });
    };
    const rec = scenarioRecurring(h.ids);
    h.setRecurring({ ...rec, outflow_streams: [...rec.outflow_streams, s('ZOUT', 'outflow')], inflow_streams: [...rec.inflow_streams, s('ZIN', 'inflow')] });
    await h.sync('link');
    const z = (await itemsOf(h.ids.userId)).filter((i) => i.vendorKey === 'zelleco');
    expect(z.map((i) => [i.direction, i.subjectKey, i.status]).sort()).toEqual([
      ['inflow', 'inflow:zelleco', 'open'], ['outflow', 'outflow:zelleco', 'open'],
    ]);
    // "Not a bill" on one leaves the other.
    const out = z.find((i) => i.direction === 'outflow')!;
    await answer(ctx(), h.ids.userId, { item_id: out.id, answer: 'not_bill' }, NOW_MS);
    await h.sync('after');
    const after = (await itemsOf(h.ids.userId)).filter((i) => i.vendorKey === 'zelleco');
    expect(after.map((i) => [i.direction, i.status]).sort()).toEqual([['inflow', 'open'], ['outflow', 'dismissed']]);
  }, 180000);

  it('extra: the answer callable refuses same_bill (Phase 2) and enforces the bill owner on keep_separate', async () => {
    const h = await makeHarness(db, 'qzxcall', mocks, { flag: true });
    await h.sync('link');
    const other = await makeHarness(db, 'qzxcallo', mocks, { flag: false });
    await other.sync('link');
    const uid = h.ids.userId;
    const mk = (record_id: string, subject: string) => make_review_item({
      user_id: uid, kind: 'same_bill', direction: 'outflow', source: 'plaid', status: 'open', answer: null, subject_key: subject,
      vendor_key: 'spotify', account_id: h.ids.chk, plaid_item_doc_id: h.ids.itemDocId, stream_id: subject, record_id,
      name: 'Spotify', amount: 16.99, frequency: 'monthly', plaid_status: 'MATURE', category: null, transaction_ids: [],
      next_due_ms: null, user_frequency: null, resolved_at_ms: null,
    }, NOW_MS);
    const mine = mk(h.ids.streams.SPOT, `${h.ids.tag}_S_NEWSPOT`);
    const foreign = mk(other.ids.streams.SPOT, `${h.ids.tag}_S_NEWSPOT2`); // the "stopped bill" is another user's
    await recurring_review_repo.upsert_items(ctx(), [mine, foreign]);
    await expect(answer(ctx(), uid, { item_id: mine.id, answer: 'same_bill' }, NOW_MS)).rejects.toThrow(/not available yet/);
    await expect(answer(ctx(), uid, { item_id: foreign.id, answer: 'keep_separate' }, NOW_MS)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect((await recurring_review_repo.get_item(ctx(), foreign.id)).status).toBe('open'); // nothing written
    expect((await answer(ctx(), uid, { item_id: mine.id, answer: 'keep_separate' }, NOW_MS)).status).toBe('resolved');
  }, 180000);
});
