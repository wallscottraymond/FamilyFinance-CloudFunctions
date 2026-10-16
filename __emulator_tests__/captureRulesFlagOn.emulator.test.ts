/**
 * Emulator — capture rules v2 with the flag ON (Convert-To-Recurring Phase 1 step 2).
 *
 * Suites named in the test plan (D):
 *   lowConfidenceSuggested — EARLY / UNKNOWN streams make no bill, one tile each, out of totals;
 *   plaidInactiveStillABill — a shown v2 bill Plaid turns off stays expected + asks (D5, D10);
 *   rejectedStreamNoStale — a validation-rejected v2 stream is not stale-marked (gap 8);
 * plus R5 (idempotent re-syncs), X2 (first link with 20 ended streams), X10 (existing v2 stream
 * turns UNKNOWN / TOMBSTONED → kept), F2 / F8 (go-forward tracking), G5 (two owners, one vendor).
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern captureRulesFlagOn"
 */
import * as admin from 'firebase-admin';
import {
  FAKE_CLOCK, OCT, SEP, makeHarness, paidTotal, plaidTxn, scenarioRecurring, seedMonths,
} from './helpers/captureHarness';
import { startCounting } from './helpers/firestoreCounter';
import { plaidStream } from './helpers/captureScenario';

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

let db: FirebaseFirestore.Firestore;
const mocks = { mockSync, mockRecurring };

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  // Load the orchestrators BEFORE touching Firestore (a legacy module calls db.settings()).
  /* eslint-disable @typescript-eslint/no-var-requires */
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  require('../src/functions/orchestrators/periods/derive_period.orchestrator');
  /* eslint-enable @typescript-eslint/no-var-requires */
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());

const outflow = async (id: string) => (await db.collection('outflows').doc(id).get()).data();
const items_of = async (uid: string) =>
  (await db.collection('recurring_review_items').where('userId', '==', uid).get()).docs.map((d) => d.data());
const state_of = async (uid: string) => (await db.collection('_recurring_review_state').doc(uid).get()).data();

describe('lowConfidenceSuggested + first link with the flag on', () => {
  it('EARLY / UNKNOWN → no bill, a tile each, out of totals; mature → v2 bills; tombstoned skipped; ended unstamped', async () => {
    const h = await makeHarness(db, 'qzlow', mocks, { flag: true });
    await h.sync('link');
    const S = h.ids.streams;
    // Created v2: the mature, active, known-schedule streams.
    for (const s of ['SPOT', 'CCPAY', 'XFER']) {
      const o = await outflow(S[s]);
      expect([s, o?.captureRulesVersion, o?.plaidIsActive, o?.isActive]).toEqual([s, 2, true, true]);
    }
    expect((await db.collection('inflows').doc(S.PAY).get()).data()?.captureRulesVersion).toBe(2);
    // No record for the low-confidence + tombstoned streams.
    for (const s of ['SUNBIT', 'AVANT', 'TOMB']) expect(await outflow(S[s])).toBeUndefined();
    // First seen inactive (X2): today's handling — an inactive, unstamped record, no question.
    const gym = await outflow(S.GYM);
    expect([gym?.isActive, gym?.captureRulesVersion]).toEqual([false, undefined]);
    // Tiles: one per low-confidence vendor (Sunbit, Avant), none for tombstoned / ended.
    const items = await items_of(h.ids.userId);
    expect(items.map((i) => [i.kind, i.name, i.status, i.source]).sort()).toEqual([
      ['suggested', 'Avant', 'open', 'plaid'],
      ['suggested', 'Sunbit', 'open', 'plaid'],
    ]);
    expect(items.find((i) => i.name === 'Avant')?.frequency).toBeNull(); // UNKNOWN → the user picks (D8)
    // Their payments are held out of fuzzy matching and are not bill payments.
    const state = await state_of(h.ids.userId);
    expect(new Set(state?.suppressedTxnIds)).toEqual(new Set([
      h.ids.txn('sunbit0'), h.ids.txn('sunbit1'), h.ids.txn('avant0'), h.ids.txn('avant1'), h.ids.txn('avant2'),
      h.ids.txn('hulu0'), h.ids.txn('hulu1'),
    ]));
    for (const k of ['sunbit0', 'avant0', 'hulu0']) expect((await h.txn(k))?.splits[0].outflowId ?? null).toBeNull();
    // The period page: no Sunbit / Avant / Hulu bill; their October payments count as spending.
    const oct = await h.derive(OCT);
    const shown = oct.bills.map((b: { recurring_id: string }) => b.recurring_id).sort();
    expect(shown).toEqual([S.CCPAY, S.SPOT].sort());
    // Oct spending = groceries (81, as today) + Sunbit 50 + Avant 82 + Hulu 17.99 (normal transactions now).
    expect(await h.eeSpent(OCT)).toBe(230.99);
  }, 120000);

  it('R5: 5 identical re-syncs → items created once; runs 2–5 write 0 review docs, 0 state, 0 bill docs', async () => {
    const h = await makeHarness(db, 'qzidem', mocks, { flag: true });
    await h.sync('link');
    const per: Array<Record<string, number>> = [];
    for (let n = 0; n < 5; n++) {
      const c = startCounting();
      await h.sync(`re${n}`);
      await new Promise((r) => setTimeout(r, 300));
      const k = c.stop();
      per.push({
        review: k.writes_by.recurring_review_items ?? 0, state: k.writes_by._recurring_review_state ?? 0,
        outflows: k.writes_by.outflows ?? 0, inflows: k.writes_by.inflows ?? 0, audit: k.writes_by._audit ?? 0,
        bumps: k.writes_by.user_data_versions ?? 0, reads: k.reads, review_reads: (k.reads_by.recurring_review_items ?? 0) + (k.reads_by._recurring_review_state ?? 0),
      });
    }
    console.log('[R5] flag-on identical re-syncs:', JSON.stringify(per));
    for (const r of per) expect({ ...r, reads: 0, review_reads: 0 }).toEqual({ review: 0, state: 0, outflows: 0, inflows: 0, audit: 0, bumps: 0, reads: 0, review_reads: 0 });
    expect((await items_of(h.ids.userId)).length).toBe(2);
  }, 120000);
});

describe('X2 — first link with 20 ended streams', () => {
  it('→ 0 active bills, 0 Still a bill?', async () => {
    const tag = 'qzend';
    const base = scenarioRecurring({ ...((await import('./helpers/captureScenario')).scenarioIds(tag)) });
    const ids = (await import('./helpers/captureScenario')).scenarioIds(tag);
    const ended = Array.from({ length: 20 }, (_, i) => {
      ids.streams[`END${i}`] = `${tag}_S_END${i}`;
      return plaidStream(ids, `END${i}`, {
        account: 'chk', keys: [], amount: 20 + i, description: `OLD THING ${i}`, merchant: `Old ${i}`,
        primary: 'GENERAL_SERVICES', detailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES', frequency: 'MONTHLY',
        status: 'MATURE', is_active: false, first_days_ago: 700, last_days_ago: 400, next_days: null,
      });
    });
    const h = await makeHarness(db, tag, mocks, { flag: true, recurring: { ...base, outflow_streams: ended, inflow_streams: [] } });
    await h.sync('link');
    const recs = await db.collection('outflows').where('ownerId', '==', h.ids.userId).get();
    expect(recs.size).toBe(20);
    expect(recs.docs.filter((d) => d.data().isActive).length).toBe(0);
    expect(recs.docs.filter((d) => d.data().captureRulesVersion).length).toBe(0);
    expect((await items_of(h.ids.userId)).length).toBe(0);
  }, 120000);
});

describe('plaidInactiveStillABill (D5, D10, X2) + F2 / F8 go-forward', () => {
  it('Plaid turns v2 Spotify off → stays expected, asks once; payments while "inactive" still pay it', async () => {
    const h = await makeHarness(db, 'qzinact', mocks, { flag: true });
    await h.sync('link');
    const SPOT = h.ids.streams.SPOT;
    const sep_before = await h.bill(SEP, SPOT);
    expect(paidTotal(sep_before)).toBe(15.49);

    // F2: a new posted payment Plaid adds to the v2 stream → linked, period paid.
    const p1 = plaidTxn(h.ids, { key: 'spotnew1', account: 'chk', amount: 15.49, days_ago: 0, name: 'SPOTIFY USA',
      merchant: 'Spotify', primary: 'ENTERTAINMENT', detailed: 'ENTERTAINMENT_MUSIC_AND_AUDIO' });
    h.postTxns([p1]);
    const rec = scenarioRecurring(h.ids, { SPOT: { transaction_keys: ['spot0', 'spot1', 'spot2', 'spot3', 'spot4', 'spotnew1'] } });
    h.setRecurring(rec);
    await h.sync('f2');
    expect((await h.txn('spotnew1'))?.splits[0].outflowId).toBe(SPOT);

    // Plaid marks it inactive (while payments continue).
    const off = scenarioRecurring(h.ids, { SPOT: { is_active: false, transaction_keys: ['spot0', 'spot1', 'spot2', 'spot3', 'spot4', 'spotnew1'] } });
    h.setRecurring(off);
    await h.sync('off');
    const o = await outflow(SPOT);
    expect([o?.isActive, o?.plaidIsActive, o?.captureRulesVersion]).toEqual([true, false, 2]);
    const q = (await items_of(h.ids.userId)).filter((i) => i.kind === 'still_a_bill');
    expect(q.map((i) => [i.recordId, i.status])).toEqual([[SPOT, 'open']]);
    // Past periods intact + still expected (D10).
    expect(paidTotal(await h.bill(SEP, SPOT))).toBe(15.49);
    expect(await h.bill(OCT, SPOT)).toBeDefined();

    // F8: a payment posted while Plaid says inactive → linked; paid.
    const p2 = plaidTxn(h.ids, { key: 'spotnew2', account: 'chk', amount: 15.49, days_ago: 0, name: 'SPOTIFY USA',
      merchant: 'Spotify', primary: 'ENTERTAINMENT', detailed: 'ENTERTAINMENT_MUSIC_AND_AUDIO' });
    h.postTxns([p2]);
    h.setRecurring(scenarioRecurring(h.ids, { SPOT: { is_active: false, transaction_keys: ['spot0', 'spot1', 'spot2', 'spot3', 'spot4', 'spotnew1', 'spotnew2'] } }));
    await h.sync('f8');
    expect((await h.txn('spotnew2'))?.splits[0].outflowId).toBe(SPOT);
    // Re-sync: no second question, no rewrite of the item.
    const c = startCounting();
    await h.sync('again');
    await new Promise((r) => setTimeout(r, 300));
    const k = c.stop();
    expect(k.writes_by.recurring_review_items ?? 0).toBe(0);
    expect((await items_of(h.ids.userId)).filter((i) => i.kind === 'still_a_bill').length).toBe(1);

    // Plaid turns it back on → the question closes.
    h.setRecurring(scenarioRecurring(h.ids, { SPOT: { transaction_keys: ['spot0', 'spot1', 'spot2', 'spot3', 'spot4', 'spotnew1', 'spotnew2'] } }));
    await h.sync('on');
    const after = (await items_of(h.ids.userId)).find((i) => i.kind === 'still_a_bill');
    expect([after?.status, after?.answer]).toEqual(['resolved', 'auto_active']);
    expect((await outflow(SPOT))?.plaidIsActive).toBe(true);
  }, 180000);
});

describe('rejectedStreamNoStale (gap 8) + X10 existing v2 stream turns UNKNOWN / TOMBSTONED / disappears', () => {
  it('rejected → kept, no stale; UNKNOWN/TOMBSTONED → kept active; disappears → asked, not dropped', async () => {
    const h = await makeHarness(db, 'qzrej', mocks, { flag: true });
    await h.sync('link');
    const SPOT = h.ids.streams.SPOT;
    const rec = scenarioRecurring(h.ids);
    rec.outflow_streams = rec.outflow_streams.map((s) => (s.stream_id === SPOT ? { ...s, first_date: '2027-06-01' } : s));
    h.setRecurring(rec);
    await h.sync('rejected');
    let o = await outflow(SPOT);
    expect([o?.isActive, o?.plaidStatus]).toEqual([true, 'MATURE']); // today: STALE + inactive

    for (const status of ['UNKNOWN', 'TOMBSTONED', 'EARLY_DETECTION']) {
      h.setRecurring(scenarioRecurring(h.ids, { SPOT: { status, frequency: status === 'UNKNOWN' ? 'UNKNOWN' : 'MONTHLY' } }));
      await h.sync(`st_${status}`);
      o = await outflow(SPOT);
      expect([status, o?.isActive, o?.frequency]).toEqual([status, true, 'monthly']);
    }
    expect((await items_of(h.ids.userId)).filter((i) => i.kind === 'still_a_bill').length).toBe(0);

    // Plaid stops returning it entirely → not stale; plaidIsActive=false; one "Still a bill?".
    const gone = scenarioRecurring(h.ids);
    gone.outflow_streams = gone.outflow_streams.filter((s) => s.stream_id !== SPOT);
    h.setRecurring(gone);
    await h.sync('gone');
    o = await outflow(SPOT);
    expect([o?.isActive, o?.plaidIsActive]).toEqual([true, false]);
    expect(o?.plaidStatus).not.toBe('STALE');
    expect((await items_of(h.ids.userId)).filter((i) => i.kind === 'still_a_bill' && i.status === 'open').length).toBe(1);
  }, 180000);
});

describe('G5 / G1 — suggestions belong to the account owner', () => {
  it('two owners with the same vendor get separate items, each keyed to its owner', async () => {
    const a = await makeHarness(db, 'qzowna', mocks, { flag: true });
    await a.sync('link');
    const b = await makeHarness(db, 'qzownb', mocks, { flag: true });
    await b.sync('link');
    const ia = await items_of(a.ids.userId);
    const ib = await items_of(b.ids.userId);
    expect(ia.map((i) => i.name).sort()).toEqual(['Avant', 'Sunbit']);
    expect(ib.map((i) => i.name).sort()).toEqual(['Avant', 'Sunbit']);
    for (const i of ia) expect(i.id.startsWith(`${a.ids.userId}__`)).toBe(true);
    for (const i of ib) expect(i.id.startsWith(`${b.ids.userId}__`)).toBe(true);
    expect(new Set([...ia, ...ib].map((i) => i.id)).size).toBe(4);
  }, 120000);
});
