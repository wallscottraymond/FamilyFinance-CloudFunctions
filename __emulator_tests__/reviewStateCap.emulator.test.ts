/**
 * Emulator — Top-25 #8 "cap boundary" (review round 3 defect 6).
 *
 * The held-out ids are capped at MAX_SUPPRESSED_TXN_IDS. An insertion-order cap evicted a different
 * subset on every sync (each re-added id pushed another out) → a state write, a derive bump and a
 * re-assign EVERY sync. With the deterministic (sorted) cap, 4,999 / 5,000 / 5,001 / 5,600 held-out
 * ids over 5 identical syncs → at most 1 state write, at most 1 bump, 0 re-assigns after run 1,
 * and the state doc stays under 1 MB.
 */
import * as admin from 'firebase-admin';
import { FAKE_CLOCK, makeHarness, scenarioRecurring, seedMonths } from './helpers/captureHarness';
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
let transaction_repo: any;
let MAX: number;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  ({ transaction_repo } = require('../src/functions/repositories'));
  ({ MAX_SUPPRESSED_TXN_IDS: MAX } = require('../src/functions/domain/recurring/review_item.service'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };

describe('held-out cap boundary (emulator, defect 6)', () => {
  for (const extra of [-1, 0, 1, 600]) {
    it(`MAX${extra >= 0 ? '+' : ''}${extra} held-out ids: 5 identical syncs → ≤1 state write, ≤1 bump, 0 re-assigns after run 1`, async () => {
      const tag = `qzcap${extra < 0 ? 'm' : 'p'}${Math.abs(extra)}`;
      const h = await makeHarness(db, tag, mocks, { flag: true });
      await h.sync('link');
      const uid = h.ids.userId;
      // Sunbit (EARLY_DETECTION → held out) now claims enough payments that the user's held-out
      // set (link-time ids — Sunbit, Avant, Hulu — included) totals MAX + extra.
      const at_link = (await db.collection('_recurring_review_state').doc(uid).get()).data()!.suppressedTxnIds.length;
      const n = MAX + extra - at_link;
      const keys = ['sunbit0', 'sunbit1', ...Array.from({ length: n }, (_, i) => `cap${i}`)];
      h.setRecurring(scenarioRecurring(h.ids, { SUNBIT: { transaction_keys: keys } }));
      // The ids were mostly held out already by earlier syncs (as an insertion-order cap would
      // have left them: an arbitrary subset, 10 short). Seeding that keeps run 1's re-assign to a
      // handful of ids — re-assigning ~5,000 fake ids costs ~170 'in' queries, which on a shared
      // emulator full of other suites' transactions stalls every other suite.
      const { recurring_review_repo } = require('../src/functions/repositories/recurring_review.repo');
      const earlier = keys.slice(10).map(h.ids.txn).slice(-(MAX - at_link - 10));
      await recurring_review_repo.apply_state_change({ trace_id: 't', span_id: 's' }, uid, { add_suppressed: earlier });
      const spy = jest.spyOn(transaction_repo, 'get_by_plaid_transaction_ids');
      const per_run: Array<{ state: number; bumps: number; reassigned: boolean }> = [];
      for (let run = 0; run < 5; run++) {
        spy.mockClear();
        const c = startCounting();
        await h.sync(`cap${run}`);
        const k = c.stop();
        const asked = spy.mock.calls.some((call: unknown[]) => (call[2] as string[]).some((id) => id.includes('_t_cap')));
        per_run.push({ state: k.writes_by._recurring_review_state ?? 0, bumps: k.writes_by.user_data_versions ?? 0, reassigned: asked });
      }
      spy.mockRestore();
      expect(per_run.reduce((s, r) => s + r.state, 0)).toBeLessThanOrEqual(1);
      expect(per_run.reduce((s, r) => s + r.bumps, 0)).toBeLessThanOrEqual(1);
      expect(per_run.slice(1).map((r) => r.reassigned)).toEqual([false, false, false, false]);
      const snap = await db.collection('_recurring_review_state').doc(uid).get();
      const state = snap.data()!;
      expect(state.suppressedTxnIds.length).toBe(Math.min(MAX, MAX + extra));
      expect(new Set(state.suppressedTxnIds).size).toBe(state.suppressedTxnIds.length);
      expect(Buffer.byteLength(JSON.stringify(state))).toBeLessThan(1024 * 1024);
    }, 240000);
  }
});
