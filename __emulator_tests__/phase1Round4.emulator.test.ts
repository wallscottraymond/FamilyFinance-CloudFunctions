/**
 * Emulator — Convert-To-Recurring review round 4 (planner defects 1–2 + robustness tests).
 *
 *   test 1 — a stream maturing in item1 never closes the vendor's tile owned by item2's (still
 *            low-confidence) stream: the tile stays open, owned by item2, with ≤1 item write and
 *            no close/reopen churn across alternating syncs.
 *   test 2 — "Track" on a tile owned by a stream that vanished from its item, while ANOTHER item
 *            has a live stream of the vendor: the track is handed to that item (re-sync queued),
 *            whose sync creates the bill — the user's answer is not lost.
 *   test 7 — a pending track whose stream's merchant is renamed (a new vendor key): the bill is
 *            still created from the tracked stream; nothing stays pending.
 */
import * as admin from 'firebase-admin';
import { FAKE_CLOCK, makeHarness, scenarioRecurring, seedMonths } from './helpers/captureHarness';
import { NOW_MS, plaidStream } from './helpers/captureScenario';
import { seedSecondItem } from './helpers/secondItem';
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

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-var-requires */
let db: FirebaseFirestore.Firestore;
let answer: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  ({ answer_recurring_review_item_orchestrator: answer } = require('../src/functions/orchestrators/recurring/answer_recurring_review_item.orchestrator'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const sunbit = (ids: any, name: string, account: string, keys: string[], o: Record<string, unknown> = {}) => {
  ids.streams[name] = `${ids.tag}_S_${name}`;
  return plaidStream(ids, name, {
    account: account as 'chk', keys, amount: 50, description: 'SUNBIT', merchant: 'Sunbit', primary: 'LOAN_PAYMENTS',
    detailed: 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT', frequency: 'MONTHLY', status: 'EARLY_DETECTION', is_active: true,
    first_days_ago: 35, last_days_ago: 5, next_days: 25, ...o,
  } as any);
};
const sunbitItems = async (uid: string) =>
  (await db.collection('recurring_review_items').where('userId', '==', uid).get()).docs
    .map((d) => d.data()).filter((i) => i.vendorKey === 'sunbit');
const state = async (uid: string) => (await db.collection('_recurring_review_state').doc(uid).get()).data()!;
const handoffJobs = async (item: string) =>
  (await db.collection('_jobs').where('payload.item_doc_id', '==', item).where('status', '==', 'pending').get())
    .docs.map((d) => d.data()).filter((j) => j.payload?.reason === 'track_handoff');

describe('round 4 — cross-item tiles + tracks (emulator)', () => {
  it('test 1: item1\'s stream matures → item2\'s open tile stays open, owned by item2; ≤1 item write, no churn', async () => {
    const h = await makeHarness(db, 'qzr4t1', mocks, { flag: true });
    const b = await seedSecondItem(db, h.ids, mocks);
    (h.ids as any).chk2 = b.chk;
    const recB = { ...scenarioRecurring(h.ids), outflow_streams: [sunbit(h.ids, 'SUNB2', 'chk2', ['b_sun0', 'b_sun1'])], inflow_streams: [] };
    await b.sync('linkB', recB); // the tile is item2's
    let items = await sunbitItems(h.ids.userId);
    expect(items.map((i) => [i.status, i.plaidItemDocId])).toEqual([['open', b.itemDocId]]);
    h.setRecurring(scenarioRecurring(h.ids, { SUNBIT: { status: 'MATURE' } })); // item1's Sunbit is a mature bill
    const c = startCounting();
    await h.sync('linkA');
    items = await sunbitItems(h.ids.userId);
    expect(items.map((i) => [i.status, i.answer, i.plaidItemDocId])).toEqual([['open', null, b.itemDocId]]); // not closed 'matured'
    expect((await db.collection('outflows').doc(h.ids.streams.SUNBIT).get()).data()?.captureRulesVersion).toBe(2);
    for (let n = 0; n < 3; n++) {
      await h.sync(`a${n}`);
      await b.sync(`b${n}`, recB);
    }
    const k = c.stop();
    expect(k.writes_by.recurring_review_items ?? 0).toBeLessThanOrEqual(1);
    items = await sunbitItems(h.ids.userId);
    expect(items.map((i) => [i.status, i.plaidItemDocId, i.streamId])).toEqual([['open', b.itemDocId, h.ids.streams.SUNB2]]);
    // item2's payments stay held out (its tile is still open).
    expect((await state(h.ids.userId)).suppressedTxnIds).toEqual(expect.arrayContaining([h.ids.txn('b_sun0'), h.ids.txn('b_sun1')]));
  }, 240000);

  it('test 2: Track on a tile whose stream vanished from its item, another item has a live stream → handed off, the bill is made', async () => {
    const h = await makeHarness(db, 'qzr4t2', mocks, { flag: true });
    const b = await seedSecondItem(db, h.ids, mocks);
    (h.ids as any).chk2 = b.chk;
    const recB = { ...scenarioRecurring(h.ids), outflow_streams: [sunbit(h.ids, 'SUNB2', 'chk2', ['b_sun0', 'b_sun1'])], inflow_streams: [] };
    await b.sync('linkB', recB); // tile owned by item2's SUNB2
    await h.sync('linkA'); // item1's SUNBIT is EARLY_DETECTION too: the tile stays item2's
    const [tile] = await sunbitItems(h.ids.userId);
    expect([tile.status, tile.plaidItemDocId]).toEqual(['open', b.itemDocId]);
    // Plaid drops SUNB2 from item2 (not synced yet); the user taps Track on the tile.
    const r = await answer(ctx(), h.ids.userId, { item_id: tile.id, answer: 'track' }, NOW_MS);
    expect(r.no_op).toBe(false);
    const recB_gone = { ...recB, outflow_streams: [] };
    await b.sync('afterTrack', recB_gone);
    let st = await state(h.ids.userId);
    expect((st.pendingTracks ?? []).map((p: any) => [p.itemId, p.plaidItemDocId, p.awaitingItemDocIds])).toEqual([[tile.id, null, [h.ids.itemDocId]]]);
    expect((await sunbitItems(h.ids.userId))[0].answer).toBe('track'); // not closed track_unavailable
    expect(await handoffJobs(h.ids.itemDocId)).toHaveLength(1); // item1's re-sync was queued
    // item1's (queued) sync: its live Sunbit stream becomes the bill; the track is fulfilled.
    await h.sync('handoff');
    const bill = (await db.collection('outflows').doc(h.ids.streams.SUNBIT).get()).data();
    expect(bill?.captureRulesVersion).toBe(2);
    st = await state(h.ids.userId);
    expect(st.pendingTracks ?? []).toEqual([]);
    expect(st.suppressedTxnIds ?? []).not.toEqual(expect.arrayContaining([h.ids.txn('sunbit0')]));
    expect((await sunbitItems(h.ids.userId)).map((i) => [i.id, i.status, i.answer])).toEqual([[tile.id, 'resolved', 'track']]);
    // Steady state: nothing more changes.
    const c = startCounting();
    await h.sync('again');
    await b.sync('againB', recB_gone);
    expect(c.stop().writes_by.recurring_review_items ?? 0).toBe(0);
  }, 240000);

  it('test 2b: a tile whose stream vanished is let go by its owner (stream_gone) and taken over by the live stream', async () => {
    const h = await makeHarness(db, 'qzr4t2b', mocks, { flag: true });
    const b = await seedSecondItem(db, h.ids, mocks);
    (h.ids as any).chk2 = b.chk;
    const recB = { ...scenarioRecurring(h.ids), outflow_streams: [sunbit(h.ids, 'SUNB2', 'chk2', ['b_sun0', 'b_sun1'])], inflow_streams: [] };
    await b.sync('linkB', recB);
    await h.sync('linkA');
    const sun_id = (await sunbitItems(h.ids.userId))[0].id;
    expect((await state(h.ids.userId)).suggestedOwners).toEqual(expect.arrayContaining([{ itemId: sun_id, plaidItemDocId: b.itemDocId }]));
    await b.sync('gone', { ...recB, outflow_streams: [] }); // the vendor is gone from item2 entirely
    let [tile] = await sunbitItems(h.ids.userId);
    expect([tile.status, tile.answer]).toEqual(['resolved', 'stream_gone']);
    expect((await state(h.ids.userId)).suppressedTxnIds ?? []).not.toEqual(expect.arrayContaining([h.ids.txn('b_sun0')]));
    await h.sync('takeover');
    [tile] = await sunbitItems(h.ids.userId);
    expect([tile.status, tile.plaidItemDocId, tile.streamId]).toEqual(['open', h.ids.itemDocId, h.ids.streams.SUNBIT]);
  }, 240000);

  it('test 7: a pending track whose stream\'s merchant is renamed → the bill is still made from that stream', async () => {
    const h = await makeHarness(db, 'qzr4t7', mocks, { flag: true });
    await h.sync('link');
    const [tile] = await sunbitItems(h.ids.userId);
    expect(tile.status).toBe('open');
    await answer(ctx(), h.ids.userId, { item_id: tile.id, answer: 'track' }, NOW_MS);
    const rec = scenarioRecurring(h.ids);
    const s: any = rec.outflow_streams.find((x: any) => x.stream_id === h.ids.streams.SUNBIT);
    s.merchant_name = 'Sunbit Lending Co';
    s.description = 'SUNBIT LENDING';
    h.setRecurring(rec);
    await h.sync('renamed');
    const bill = (await db.collection('outflows').doc(h.ids.streams.SUNBIT).get()).data();
    expect(bill?.captureRulesVersion).toBe(2);
    const st = await state(h.ids.userId);
    expect(st.pendingTracks ?? []).toEqual([]);
    expect(st.suppressedTxnIds ?? []).not.toEqual(expect.arrayContaining([h.ids.txn('sunbit0')]));
    const all = (await db.collection('recurring_review_items').where('userId', '==', h.ids.userId).get()).docs.map((d) => d.data());
    expect(all.filter((i) => i.kind === 'suggested' && i.status === 'open' && /sunbit/.test(i.vendorKey ?? ''))).toEqual([]);
    expect(all.find((i) => i.id === tile.id)?.answer).toBe('track');
  }, 240000);

  it('test 8: a review item with >60 payments under a reordered Plaid list → 0 rewrites', async () => {
    const h = await makeHarness(db, 'qzr4t8', mocks, { flag: true });
    const keys = Array.from({ length: 70 }, (_, i) => `big${i}`);
    const base = scenarioRecurring(h.ids);
    const big = sunbit(h.ids, 'BIG', 'chk', keys, { merchant: 'Bigvendor', description: 'BIGVENDOR' });
    h.setRecurring({ ...base, outflow_streams: [...base.outflow_streams, big] });
    await h.sync('link');
    const id_of = async () => (await db.collection('recurring_review_items').where('userId', '==', h.ids.userId).get()).docs
      .map((d) => d.data()).find((i) => i.vendorKey === 'bigvendor');
    const before = await id_of();
    expect(before?.transactionIds).toHaveLength(60);
    const c = startCounting();
    for (let n = 0; n < 3; n++) {
      const order = n % 2 ? [...big.transaction_ids].reverse() : [...big.transaction_ids.slice(35), ...big.transaction_ids.slice(0, 35)];
      h.setRecurring({ ...base, outflow_streams: [{ ...big, transaction_ids: order }, ...base.outflow_streams] });
      await h.sync(`s${n}`);
    }
    expect(c.stop().writes_by.recurring_review_items ?? 0).toBe(0);
    expect((await id_of())?.transactionIds).toEqual(before?.transactionIds);
  }, 240000);

  for (const tracked_in of ['chunk1', 'chunk2'] as const) {
    it(`test 6: a partial save_batch failure (chunk 1 commits, chunk 2 throws; the tracked bill in ${tracked_in}) → the next sync releases the ids + fulfils the track`, async () => {
      const h = await makeHarness(db, `qzr4t6${tracked_in === 'chunk1' ? 'a' : 'b'}`, mocks, { flag: true });
      await h.sync('link');
      const [tile] = await sunbitItems(h.ids.userId);
      await answer(ctx(), h.ids.userId, { item_id: tile.id, answer: 'track' }, NOW_MS);
      const { outflow_repo } = require('../src/functions/repositories');
      const orig = outflow_repo.save_batch;
      const spy = jest.spyOn(outflow_repo, 'save_batch').mockImplementationOnce((async (c: any, ents: any[], run: any, pre: any) => {
        const is_tracked = (e: any) => e.id === h.ids.streams.SUNBIT;
        const chunk1 = ents.filter((e) => (tracked_in === 'chunk1' ? is_tracked(e) : !is_tracked(e)));
        await orig.call(outflow_repo, c, chunk1, run, pre); // chunk 1 commits…
        throw new Error('chunk 2 failed'); // …chunk 2 throws
      }) as any);
      const r = await h.syncRaw('partial');
      expect(r.status).toBe('synced');
      spy.mockRestore();
      let st = await state(h.ids.userId);
      // The failed direction kept everything that depended on its saves: still pending + held.
      expect((st.pendingTracks ?? []).map((p: any) => p.itemId)).toEqual([tile.id]);
      expect(st.suppressedTxnIds).toEqual(expect.arrayContaining([h.ids.txn('sunbit0'), h.ids.txn('sunbit1')]));
      expect(!!(await db.collection('outflows').doc(h.ids.streams.SUNBIT).get()).exists).toBe(tracked_in === 'chunk1');
      // The next (healthy) sync: the bill exists (created now, or already from chunk 1) → released + fulfilled.
      await h.sync('next');
      expect((await db.collection('outflows').doc(h.ids.streams.SUNBIT).get()).data()?.captureRulesVersion).toBe(2);
      st = await state(h.ids.userId);
      expect(st.pendingTracks ?? []).toEqual([]);
      expect(st.suppressedTxnIds ?? []).not.toEqual(expect.arrayContaining([h.ids.txn('sunbit0')]));
      expect((await sunbitItems(h.ids.userId))[0].answer).toBe('track');
    }, 240000);
  }

  for (const mode of ['blocked', 'aborted_retry'] as const) {
    it(`test 9 (${mode}): an answer landing INSIDE write_items_guarded's transaction keeps the answer`, async () => {
      const h = await makeHarness(db, `qzr4t9${mode[0]}`, mocks, { flag: true });
      await h.sync('link');
      const [tile] = await sunbitItems(h.ids.userId);
      expect(tile.status).toBe('open');
      // The next sync rewrites the tile (Plaid changed its amount)…
      const rec = scenarioRecurring(h.ids);
      const sb: any = rec.outflow_streams.find((x: any) => x.stream_id === h.ids.streams.SUNBIT);
      sb.average_amount = { amount: 55, iso_currency_code: 'USD' };
      h.setRecurring(rec);
      // …and the user's "Not a bill" lands right after the guard's transaction READ the tile:
      //   blocked       — the answer write waits on the transaction's lock and lands after it;
      //   aborted_retry — the attempt is ABORTED (contention) after the answer started; the SDK
      //                   retries, and the retry reads the ANSWERED tile → skipped, not reverted.
      const { Transaction } = require('@google-cloud/firestore');
      const orig_get_all = Transaction.prototype.getAll;
      const ref = db.collection('recurring_review_items').doc(tile.id);
      let attempts = 0;
      let write: Promise<unknown> | null = null;
      Transaction.prototype.getAll = async function (...refs: any[]) {
        const hits = refs.some((r: any) => r?.path === ref.path);
        if (hits && write && mode === 'aborted_retry') await write; // the retry reads after the answer
        const snaps = await orig_get_all.apply(this, refs);
        if (hits) {
          attempts++;
          if (!write) {
            write = answer(ctx(), h.ids.userId, { item_id: tile.id, answer: 'not_bill' }, NOW_MS);
            if (mode === 'aborted_retry') throw Object.assign(new Error('simulated contention'), { code: 10 });
            await Promise.race([write, new Promise((r) => setTimeout(r, 1500))]);
          }
        }
        return snaps;
      };
      try {
        await h.sync('race');
        await write;
      } finally {
        Transaction.prototype.getAll = orig_get_all;
      }
      const after = (await ref.get()).data()!;
      expect([after.status, after.answer]).toEqual(['dismissed', 'not_bill']);
      expect(attempts).toBe(mode === 'aborted_retry' ? 2 : 1);
      // The next sync never reverts it.
      await h.sync('after');
      expect((await ref.get()).data()!.answer).toBe('not_bill');
    }, 240000);
  }
});

