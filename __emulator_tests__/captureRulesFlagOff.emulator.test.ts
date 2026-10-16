/**
 * Emulator — capture rules with the flag OFF are byte-identical to today (Convert-To-Recurring N3).
 *
 * The golden dump `golden/captureRulesFlagOff.golden.json` was produced by running THIS scenario
 * on the untouched base commit (`working` 9a73e01, before any Convert-To-Recurring code) with
 * CAPTURE_GOLDEN_WRITE=1. Here the same scenario runs on the new code with the flag off — no flag
 * doc at all, and a flag doc that doesn't list the user — and every bill / income doc, every
 * materialized period, every transaction (splits, links, budgets), the derived period page, the
 * job queue and the review collections must equal it. Two syncs: the first link and an identical
 * re-sync (which must write nothing).
 *
 * Also R4 (read parity) and R13 (no detector with the flag off): the flag-off sync reads exactly
 * what the base reads (counted around the Firestore client), and no detector job is enqueued.
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern captureRulesFlagOff"
 */
import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';
import {
  NOW_MS, dumpScenario, normalizeDoc, scenarioIds, scenarioMocks, scenarioRecurring,
  seedMonthlySourcePeriods, seedScenario,
} from './helpers/captureScenario';
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

const GOLDEN = path.join(__dirname, 'golden', 'captureRulesFlagOff.golden.json');
const WRITE = process.env.CAPTURE_GOLDEN_WRITE === '1';

let db: FirebaseFirestore.Firestore;
/* eslint-disable @typescript-eslint/no-explicit-any */
let sync_item_orchestrator: (ctx: unknown, input: unknown) => Promise<any>;
let derive_period_orchestrator: (ctx: unknown, uid: string, input: unknown) => Promise<any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers({
    now: NOW_MS, advanceTimers: true,
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
  });
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  db = admin.firestore();
  /* eslint-disable @typescript-eslint/no-var-requires */
  ({ sync_item_orchestrator } = require('../src/functions/orchestrators/plaid/sync_item.orchestrator'));
  ({ derive_period_orchestrator } = require('../src/functions/orchestrators/periods/derive_period.orchestrator'));
  /* eslint-enable @typescript-eslint/no-var-requires */
  await seedMonthlySourcePeriods(db, [[2037, 4], [2037, 5], [2037, 6], [2037, 7], [2037, 8], [2037, 9], [2037, 10], [2037, 11], [2037, 12], [2038, 1]]);
}, 60000);
afterAll(() => jest.useRealTimers());

const OCT = { start: Date.UTC(2037, 9, 1), end: Date.UTC(2037, 10, 1) - 1 };
const SEP = { start: Date.UTC(2037, 8, 1), end: Date.UTC(2037, 9, 1) - 1 };

async function runScenario(tag: string, opts: { counted?: boolean } = {}) {
  const ids = scenarioIds(tag);
  await seedScenario(db, ids);
  const mocks = scenarioMocks(ids);
  mockSync.mockReset();
  mockSync.mockImplementation(mocks.sync);
  mockRecurring.mockReset();
  mockRecurring.mockResolvedValue(scenarioRecurring(ids));
  const ctx = (n: string) => ({ trace_id: `${tag}_${n}`, span_id: 's' });

  // The flag is read through a per-instance 5-minute cache (not a per-user cost): prime it so the
  // counted sync measures the user's own reads. (No-op on the base commit, which has no flag.)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ff = require('../src/functions/infrastructure/feature_flags');
    if (ff.is_convert_to_recurring_enabled) await ff.is_convert_to_recurring_enabled(ids.userId);
  } catch { /* base commit */ }
  const counter1 = opts.counted ? startCounting() : null;
  const r1 = await sync_item_orchestrator(ctx('run1'), { item_doc_id: ids.itemDocId, user_id: ids.userId, recurring: true, reason: 'test' });
  await new Promise((r) => setTimeout(r, 400)); // let fire-and-forget audit writes land
  const c1 = counter1?.stop();
  const after_first = await dumpScenario(db, ids);

  const counter2 = opts.counted ? startCounting() : null;
  const r2 = await sync_item_orchestrator(ctx('run2'), { item_doc_id: ids.itemDocId, user_id: ids.userId, recurring: true, reason: 'test' });
  await new Promise((r) => setTimeout(r, 400));
  const c2 = counter2?.stop();
  const after_second = await dumpScenario(db, ids);

  const derive = async (w: { start: number; end: number }) =>
    normalizeDoc(await derive_period_orchestrator(ctx('derive'), ids.userId, {
      view_cadence: 'monthly', window_start_ms: w.start, window_end_ms: w.end, force: true,
    }), tag);
  return {
    ids,
    out: {
      results: [normalizeDoc(r1, tag), normalizeDoc(r2, tag)],
      after_first,
      after_second,
      derive_oct: await derive(OCT),
      derive_sep: await derive(SEP),
    },
    // `categories` is global reference data (module-cached): its read count depends on what other
    // suites left in the emulator, not on the code under test — excluded from the parity count.
    counts: [c1, c2].map((c) => c && {
      reads: c.reads - (c.reads_by._audit ?? 0) - (c.reads_by.categories ?? 0),
      writes: c.writes - (c.writes_by._audit ?? 0),
      audit_writes: c.writes_by._audit ?? 0,
      reads_by: c.reads_by,
      writes_by: c.writes_by,
    }),
  };
}

describe('capture rules — flag off equals today (emulator)', () => {
  if (WRITE) {
    it('writes the golden dump (base commit only)', async () => {
      const { out, counts } = await runScenario('qzgen', { counted: true });
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, JSON.stringify({ ...out, counts }, null, 1));
    }, 120000);
    return;
  }

  const golden = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : null;

  it('has a golden dump from the base commit', () => {
    expect(golden).not.toBeNull();
  });

  it('no flag doc → every doc, period, transaction, the period page and the queue equal the base', async () => {
    await db.collection('_feature_flags').doc('convert_to_recurring_v1').delete();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../src/functions/infrastructure/feature_flags').invalidate_flag_cache();
    const { out, counts } = await runScenario('qzoffa', { counted: true });
    const { counts: golden_counts, ...golden_out } = golden;
    expect(out).toEqual(golden_out);
    // R4: identical writes to the base, and identical reads apart from ONE review-state `get` per
    // assignment batch (X8: the engine holds suggested payments out of fuzzy matching — the only
    // new read on a flag-off sync; the capture planner itself doesn't run and reads nothing).
    const state_reads = counts.map((c) => c!.reads_by._recurring_review_state ?? 0);
    expect(counts.map((c, i) => c && { reads: c.reads - state_reads[i], writes: c.writes, audit: c.audit_writes })).toEqual(
      golden_counts.map((c: { reads: number; writes: number; audit_writes: number }) =>
        ({ reads: c.reads, writes: c.writes, audit: c.audit_writes }))
    );
    expect(Object.keys(counts[0]!.reads_by).filter((k) => !(k in golden_counts[0].reads_by))).toEqual(['_recurring_review_state']);
    console.log('[R4] flag-off sync counts (run1, run2):', JSON.stringify(counts.map((c, i) => c && {
      reads: c.reads, review_state_reads: state_reads[i], writes: c.writes, audit: c.audit_writes,
    })), 'base:', JSON.stringify(golden_counts.map((c: { reads: number; writes: number }) => ({ reads: c.reads, writes: c.writes }))));
  }, 120000);

  it('flag doc present but the user not on it → same as the base; 0 review items; no detector job', async () => {
    await db.collection('_feature_flags').doc('convert_to_recurring_v1').set({
      enabled: true, enabled_user_ids: ['someone_else'], enabled_group_ids: [], rollout_percentage: 0,
    });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../src/functions/infrastructure/feature_flags').invalidate_flag_cache();
    const { out } = await runScenario('qzoffb');
    const { counts: _c, ...golden_out } = golden;
    void _c;
    expect(out).toEqual(golden_out);
    expect(out.after_second.review_items).toBe(0);
    expect(out.after_second.review_state_exists).toBe(false);
    expect(out.after_second.job_types).not.toContain('detect_possible_recurring');
  }, 120000);
});
