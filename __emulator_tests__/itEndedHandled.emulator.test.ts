/**
 * Emulator — "It ended" / "Still a bill?" on a bill the user already handled (review round 3
 * defect 5).
 *
 *   - Top-25 #11: a v2 bill removed (all), removed going forward, or paused THIS month while its
 *     "Still a bill?" is still open (stale); answering "It ended" must never shorten the existing
 *     suppression for the current month. Before the fix the active removal was closed at "now" and
 *     the end started the month after this month's payment, so the bill came back for the rest of
 *     the month (Spotify paid Oct 5, answered Oct 15).
 *   - Top-25 #12: the user removes the bill while its "Still a bill?" is open → the next sync closes
 *     the question (not_shown) and no tile shows for the removed bill.
 */
import * as admin from 'firebase-admin';
import { FAKE_CLOCK, OCT, NOV, makeHarness, scenarioRecurring, seedMonths } from './helpers/captureHarness';
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
let answer: (ctx: any, uid: string, input: any, now: number) => Promise<any>;
let manage: any;
let outflow_repo: any;
let recurring_review_repo: any;
let is_payment_suppressed: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  ({ answer_recurring_review_item_orchestrator: answer } = require('../src/functions/orchestrators/recurring/answer_recurring_review_item.orchestrator'));
  ({ manage_recurring_removal_orchestrator: manage } = require('../src/functions/orchestrators/recurring/manage_recurring_removal.orchestrator'));
  ({ outflow_repo } = require('../src/functions/repositories/outflow.repo'));
  ({ recurring_review_repo } = require('../src/functions/repositories/recurring_review.repo'));
  ({ is_payment_suppressed } = require('../src/functions/domain/recurring/recurring_suppression.service'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const intervalsOf = async (id: string) =>
  ((await db.collection('outflows').doc(id).get()).data()!.removalIntervals as any[]).map((i) => ({ from_ms: i.fromMs, to_ms: i.toMs, mode: i.mode }));

/** Flag-on user; Spotify (v2, paid Oct 5) turned off by Plaid → "Still a bill?" open. */
async function withOpenQuestion(tag: string) {
  const h = await makeHarness(db, tag, mocks, { flag: true });
  await h.sync('link');
  const SPOT = h.ids.streams.SPOT;
  expect((await db.collection('outflows').doc(SPOT).get()).data()?.captureRulesVersion).toBe(2);
  h.setRecurring(scenarioRecurring(h.ids, { SPOT: { is_active: false } }));
  await h.sync('off');
  const q = (await recurring_review_repo.get_open_for_user(ctx(), h.ids.userId)).find((i: any) => i.kind === 'still_a_bill' && i.record_id === SPOT);
  expect(q).toBeDefined();
  return { h, uid: h.ids.userId, SPOT, q };
}
/* eslint-enable @typescript-eslint/no-var-requires */

describe('It ended / Still a bill? on an already-handled bill (emulator, defect 5)', () => {
  const cases: Array<[string, (uid: string, id: string) => Promise<unknown>]> = [
    ['removed (all)', (uid, id) => manage(ctx(), uid, [], { id, action: 'remove', mode: 'all' }, NOW_MS - 3600000, outflow_repo, 'recurring_outflow')],
    ['removed going forward', (uid, id) => manage(ctx(), uid, [], { id, action: 'remove', mode: 'going_forward' }, NOW_MS - 3600000, outflow_repo, 'recurring_outflow')],
    ['paused this month', (uid, id) => manage(ctx(), uid, [], { id, action: 'pause', resume_ms: Date.UTC(2038, 1, 15) }, NOW_MS - 3600000, outflow_repo, 'recurring_outflow')],
  ];
  cases.forEach(([label, handle], n) => {
    it(`#11 ${label}, stale open question, "It ended" → the current month stays suppressed`, async () => {
      const { h, uid, SPOT, q } = await withOpenQuestion(`qzeh${n}`);
      await handle(uid, SPOT);
      const before = await intervalsOf(SPOT);
      expect(is_payment_suppressed(before, NOW_MS)).toBe(true);
      const bill_before = await h.bill(OCT, SPOT);
      await answer(ctx(), uid, { item_id: q.id, answer: 'it_ended' }, NOW_MS);
      const after = await intervalsOf(SPOT);
      if (label.startsWith('removed')) expect(after).toEqual(before); // already ended: nothing written
      // Never shortened: October (this month) and every later month stay suppressed.
      expect(is_payment_suppressed(after, NOW_MS)).toBe(true);
      expect(is_payment_suppressed(after, Date.UTC(2037, 9, 31, 23))).toBe(true);
      expect(is_payment_suppressed(after, Date.UTC(2038, 2, 20))).toBe(true); // a pause never resumes
      // The period page for October is unchanged by the answer (no bill came back).
      expect(await h.bill(OCT, SPOT)).toEqual(bill_before);
      expect((await h.bill(NOV, SPOT))?.groups?.flatMap((g: any) => g.occurrences) ?? []).toEqual([]);
      const item = (await recurring_review_repo.get_item(ctx(), q.id))!;
      expect([item.status, item.answer]).toEqual(['resolved', 'it_ended']);
    }, 180000);
  });

  it('#12 removed while "Still a bill?" is open → the next sync closes it; no tile for a removed bill', async () => {
    const { h, uid, SPOT, q } = await withOpenQuestion('qzehrm');
    await manage(ctx(), uid, [], { id: SPOT, action: 'remove', mode: 'going_forward' }, NOW_MS, outflow_repo, 'recurring_outflow');
    await h.sync('after_remove');
    const item = (await recurring_review_repo.get_item(ctx(), q.id))!;
    expect([item.status, item.answer]).toEqual(['resolved', 'not_shown']);
    const open = await recurring_review_repo.get_open_for_user(ctx(), uid);
    expect(open.filter((i: any) => i.record_id === SPOT)).toEqual([]);
    // Later syncs leave it closed (no refresh, no reopen while removed).
    for (let k = 0; k < 2; k++) await h.sync(`re${k}`);
    expect((await recurring_review_repo.get_open_for_user(ctx(), uid)).filter((i: any) => i.record_id === SPOT)).toEqual([]);
  }, 180000);
});
