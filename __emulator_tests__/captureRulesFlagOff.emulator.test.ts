/**
 * Emulator — capture rules with the flag OFF are byte-identical to today (Convert-To-Recurring N3).
 *
 * The golden dump `golden/captureRulesFlagOff.golden.json` was produced by running THIS scenario
 * on the untouched base commit (`working` 2ae62e6, before any Convert-To-Recurring code; only the
 * harness files copied in) with CAPTURE_GOLDEN_WRITE=1. Here the same scenario runs on the new code with the flag off — no flag
 * doc at all, and a flag doc that doesn't list the user — and every bill / income doc, every
 * materialized period, every transaction (splits, links, budgets), the derived period page, the
 * job queue and the review collections must equal it. Two syncs: the first link and an identical
 * re-sync (which must write nothing).
 *
 * Review round 3 (Top-25 #1): the scenario also has three OLD bills the user then removes (from
 * Oct 1), removes + restores (Sep 1 → Oct 20) and pauses (Sep 1 → Oct 2); after that the period
 * page is derived monthly (Sep, Oct), weekly and twice-a-month (Sep–Oct). Monthly output must
 * equal the base exactly (D26); the weekly / twice-a-month output may differ from the base in
 * EXACTLY the A2 cases (a)–(c) — the bill groups listed below (+ Everything Else's leftover in those
 * same buckets, which follows the bills due there) — and nowhere else. Weekly / twice-a-month
 * source periods are added in-process only (spy on source_period_repo.get_overlapping during the
 * derive) so no other suite ever sees them.
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
import { Timestamp } from 'firebase-admin/firestore';
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
const SEP_OCT = { start: SEP.start, end: OCT.end };
const DAY = 86400000;

/** In-process weekly (Sun–Sat) + twice-a-month source periods, Aug 23 – Nov 2037. Oct 1 2037 is a
 *  Thursday, so the week of Sun Sep 27 straddles a removal that starts Oct 1. */
const SYNTHETIC = (() => {
  const out: Array<{ id: string; period_id: string; period_type: string; start_date: Timestamp; end_date: Timestamp; year: number; index: number }> = [];
  const add = (id: string, type: string, start: number, end: number) =>
    out.push({ id, period_id: id, period_type: type, start_date: Timestamp.fromMillis(start), end_date: Timestamp.fromMillis(end), year: 2037, index: 0 });
  for (let s = Date.UTC(2037, 7, 23), n = 0; s < Date.UTC(2037, 10, 15); s += 7 * DAY, n++) add(`2037SW${String(n).padStart(2, '0')}`, 'weekly', s, s + 7 * DAY - 1);
  for (const m of [7, 8, 9, 10]) {
    add(`2037SBM${m + 1}A`, 'bi_monthly', Date.UTC(2037, m, 1), Date.UTC(2037, m, 16) - 1);
    add(`2037SBM${m + 1}B`, 'bi_monthly', Date.UTC(2037, m, 16), Date.UTC(2037, m + 1, 1) - 1);
  }
  return out;
})();
const period_id_at = (type: string, start_ms: number) =>
  SYNTHETIC.find((p) => p.period_type === type && p.start_date.toMillis() === start_ms)!.id;

/** Run `fn` with the synthetic periods visible to THIS process's derive only. */
async function withSyntheticPeriods<T>(fn: () => Promise<T>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const repo = require('../src/functions/repositories/source_period.repo').source_period_repo;
  const orig = repo.get_overlapping;
  repo.get_overlapping = async (ctx: unknown, anchor: Timestamp, end: Timestamp) => {
    const real = await orig.call(repo, ctx, anchor, end);
    const lower = anchor.toMillis() - 31 * DAY;
    const extra = SYNTHETIC.filter((p) =>
      p.start_date.toMillis() >= lower && p.start_date.toMillis() <= end.toMillis() && p.end_date.toMillis() >= anchor.toMillis());
    return [...real, ...extra].sort((a, b) => a.start_date.toMillis() - b.start_date.toMillis());
  };
  try {
    return await fn();
  } finally {
    repo.get_overlapping = orig;
  }
}

async function runScenario(tag: string, opts: { counted?: boolean } = {}) {
  const ids = scenarioIds(tag);
  await seedScenario(db, ids);
  const mocks = scenarioMocks(ids, NOW_MS, { removals: true });
  mockSync.mockReset();
  mockSync.mockImplementation(mocks.sync);
  mockRecurring.mockReset();
  mockRecurring.mockResolvedValue(scenarioRecurring(ids, {}, NOW_MS, { removals: true }));
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

  const derive = async (w: { start: number; end: number }, cadence = 'monthly') =>
    normalizeDoc(await derive_period_orchestrator(ctx('derive'), ids.userId, {
      view_cadence: cadence, window_start_ms: w.start, window_end_ms: w.end, force: true,
    }), tag);
  const derive_oct = await derive(OCT);
  const derive_sep = await derive(SEP);

  // The user removes / restores / pauses the three OLD bills (the A2 boundary cases).
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { manage_recurring_removal_orchestrator: manage } = require('../src/functions/orchestrators/recurring/manage_recurring_removal.orchestrator');
  const { outflow_repo } = require('../src/functions/repositories/outflow.repo');
  /* eslint-enable @typescript-eslint/no-var-requires */
  const act = (k: string, input: Record<string, unknown>, now: number) =>
    manage(ctx(`rm_${k}`), ids.userId, [], { id: ids.streams[k], ...input }, now, outflow_repo, 'recurring_outflow');
  await act('RMV', { action: 'remove', mode: 'going_forward' }, NOW_MS); // from Oct 1
  await act('RST', { action: 'remove', mode: 'going_forward' }, Date.UTC(2037, 8, 10)); // from Sep 1
  await act('RST', { action: 'restore' }, Date.UTC(2037, 9, 20)); // restored Oct 20
  await act('PSE', { action: 'pause', resume_ms: Date.UTC(2037, 9, 2) }, Date.UTC(2037, 8, 10)); // Sep 1 → Oct 2
  await new Promise((r) => setTimeout(r, 400));
  const after_removals = await dumpScenario(db, ids);
  const derive_removed = await withSyntheticPeriods(async () => ({
    monthly_sep: await derive(SEP),
    monthly_oct: await derive(OCT),
    weekly: await derive(SEP_OCT, 'weekly'),
    bi_monthly: await derive(SEP_OCT, 'bi_monthly'),
  }));
  return {
    ids,
    out: {
      results: [normalizeDoc(r1, tag), normalizeDoc(r2, tag)],
      after_first,
      after_second,
      derive_oct,
      derive_sep,
      after_removals,
      derive_removed,
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

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Per (bill | budget | income) × period: the derived group / period, keyed for diffing. */
function cells(view: any): Map<string, string> {
  const m = new Map<string, string>();
  for (const b of view.bills ?? []) for (const g of b.groups ?? []) m.set(`bill:${b.recurring_id}@${g.period_id}`, JSON.stringify(g));
  for (const b of view.income ?? []) for (const g of b.groups ?? []) m.set(`income:${b.recurring_id}@${g.period_id}`, JSON.stringify(g));
  for (const b of view.budgets ?? []) for (const p of b.periods ?? []) m.set(`budget:${b.budget_id}@${p.period_id}`, JSON.stringify(p));
  return m;
}
const diff_keys = (a: any, b: any): string[] => {
  const ca = cells(a);
  const cb = cells(b);
  return [...new Set([...ca.keys(), ...cb.keys()])].filter((k) => ca.get(k) !== cb.get(k)).sort();
};

/**
 * Everything equals the base golden, except the weekly / twice-a-month views after the removals,
 * which differ in EXACTLY the A2 cases: (a) the removed bill's straddling week now shows its Sep 29
 * payment, (b) the restored bill's Oct 12 week and Oct 1–15 half now show it, (c) the paused bill's
 * straddling week no longer expects a Sep 29 occurrence — plus Everything Else's leftover in those
 * buckets only (it follows the bills due there). The bill-level outcome of each case is checked.
 */
function expectGoldenWithA2(out: any, golden_all: any): void {
  const { derive_removed: got_removed, ...got_rest } = out;
  const { derive_removed: base_removed, ...base_rest } = golden_all;
  expect(got_rest).toEqual(base_rest);
  expect(got_removed.monthly_sep).toEqual(base_removed.monthly_sep); // monthly views byte-identical (D26)
  expect(got_removed.monthly_oct).toEqual(base_removed.monthly_oct);
  const W_SEP27 = period_id_at('weekly', Date.UTC(2037, 8, 27));
  const W_OCT11 = period_id_at('weekly', Date.UTC(2037, 9, 11));
  const BM_OCT_A = period_id_at('bi_monthly', Date.UTC(2037, 9, 1));
  const ee = (base_removed.weekly.budgets as any[]).find((b) => b.is_everything_else)?.budget_id;
  const allowed = (keys: string[], buckets: string[]) =>
    keys.filter((k) => !(k.startsWith(`budget:${ee}@`) && buckets.some((b) => k.endsWith(`@${b}`))));
  const weekly_diff = diff_keys(got_removed.weekly, base_removed.weekly);
  expect(allowed(weekly_diff, [W_SEP27, W_OCT11])).toEqual([
    `bill:TAG_S_PSE@${W_SEP27}`, `bill:TAG_S_RMV@${W_SEP27}`, `bill:TAG_S_RST@${W_OCT11}`,
  ].sort());
  const bm_diff = diff_keys(got_removed.bi_monthly, base_removed.bi_monthly);
  expect(allowed(bm_diff, [BM_OCT_A])).toEqual([`bill:TAG_S_RST@${BM_OCT_A}`]);
  // …and each case went the right way.
  const group = (view: any, bill: string, pid: string) =>
    (view.bills as any[]).find((b) => b.recurring_id === bill)?.groups.find((g: any) => g.period_id === pid);
  const occ = (g: any) => (g?.occurrences ?? []).map((o: any) => [new Date(o.due_ms).toISOString().slice(0, 10), o.paid]);
  expect(group(base_removed.weekly, 'TAG_S_RMV', W_SEP27)).toBeUndefined(); // (a) base: hidden, payment nowhere
  expect(occ(group(got_removed.weekly, 'TAG_S_RMV', W_SEP27))).toEqual([['2037-09-29', true]]);
  expect(group(base_removed.weekly, 'TAG_S_RST', W_OCT11)).toBeUndefined(); // (b)
  expect(occ(group(got_removed.weekly, 'TAG_S_RST', W_OCT11))).toEqual([['2037-10-12', true]]);
  expect(group(base_removed.bi_monthly, 'TAG_S_RST', BM_OCT_A)).toBeUndefined();
  expect(occ(group(got_removed.bi_monthly, 'TAG_S_RST', BM_OCT_A))).toEqual([['2037-10-12', true]]);
  expect(occ(group(base_removed.weekly, 'TAG_S_PSE', W_SEP27))).toEqual([['2037-09-29', false]]); // (c) base: expected in a paused month
  expect(occ(group(got_removed.weekly, 'TAG_S_PSE', W_SEP27))).toEqual([]); // now: listed, no occurrence
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
    await db.collection(process.env.FEATURE_FLAGS_COLLECTION_OVERRIDE ?? '_feature_flags').doc('convert_to_recurring_v1').delete();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../src/functions/infrastructure/feature_flags').invalidate_flag_cache();
    const { out, counts } = await runScenario('qzoffa', { counted: true });
    const { counts: golden_counts, ...golden_all } = golden;
    expectGoldenWithA2(out, golden_all);
    // R4 / X11: identical writes AND reads to the base — a flag-off user with no v2 records never
    // reads the review state doc (the hold-out loads only for flag-on / v2 users), and the capture
    // planner doesn't run.
    const state_reads = counts.map((c) => c!.reads_by._recurring_review_state ?? 0);
    expect(state_reads).toEqual(counts.map(() => 0));
    expect(counts.map((c, i) => c && { reads: c.reads - state_reads[i], writes: c.writes, audit: c.audit_writes })).toEqual(
      golden_counts.map((c: { reads: number; writes: number; audit_writes: number }) =>
        ({ reads: c.reads, writes: c.writes, audit: c.audit_writes }))
    );
    expect(Object.keys(counts[0]!.reads_by).filter((k) => !(k in golden_counts[0].reads_by))).toEqual([]);
    console.log('[R4] flag-off sync counts (run1, run2):', JSON.stringify(counts.map((c, i) => c && {
      reads: c.reads, review_state_reads: state_reads[i], writes: c.writes, audit: c.audit_writes,
    })), 'base:', JSON.stringify(golden_counts.map((c: { reads: number; writes: number }) => ({ reads: c.reads, writes: c.writes }))));
  }, 120000);

  it('flag doc present but the user not on it → same as the base; 0 review items; no detector job', async () => {
    await db.collection(process.env.FEATURE_FLAGS_COLLECTION_OVERRIDE ?? '_feature_flags').doc('convert_to_recurring_v1').set({
      enabled: true, enabled_user_ids: ['someone_else'], enabled_group_ids: [], rollout_percentage: 0,
    });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../src/functions/infrastructure/feature_flags').invalidate_flag_cache();
    const { out } = await runScenario('qzoffb');
    const { counts: _c, ...golden_all } = golden;
    void _c;
    expectGoldenWithA2(out, golden_all);
    expect(out.after_second.review_items).toBe(0);
    expect(out.after_second.review_state_exists).toBe(false);
    expect(out.after_second.job_types).not.toContain('detect_possible_recurring');
  }, 120000);
});
