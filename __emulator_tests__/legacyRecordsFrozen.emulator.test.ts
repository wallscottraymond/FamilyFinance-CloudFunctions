/**
 * Emulator — N4 "legacy records frozen" (Convert-To-Recurring D13).
 *
 * Records that exist before the release keep today's behavior forever, flag on or off. Two twin
 * users get the same first link with the flag OFF (old records). Then twin A turns the flag ON and
 * twin B stays OFF, and both receive the same changes on EVERY path the capture rules touch:
 *   - Plaid turns Spotify inactive, stops returning the old gym (stale), keeps Sunbit EARLY,
 *     sends Avant malformed (validation-rejected), changes Hulu to UNKNOWN;
 *   - a new Spotify payment posts (assignment / stream link / reconcile);
 *   - a forced transfer re-classification (the classifier);
 *   - the derived period page.
 * Twin A must equal twin B exactly (docs, periods, transactions, derive), and twin A gets no
 * review items about old records. (New streams are covered by the planner suites.)
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern legacyRecordsFrozen"
 */
import * as admin from 'firebase-admin';
import {
  NOW_MS, dumpScenario, normalizeDoc, plaidTxn, scenarioIds, scenarioMocks, scenarioRecurring,
  seedMonthlySourcePeriods, seedScenario,
} from './helpers/captureScenario';

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
/* eslint-disable @typescript-eslint/no-explicit-any */
let sync_item_orchestrator: (ctx: unknown, input: unknown) => Promise<any>;
let derive_period_orchestrator: (ctx: unknown, uid: string, input: unknown) => Promise<any>;
let classify: (ctx: unknown, uid: string, now: number, opts?: unknown) => Promise<any>;
/* eslint-enable @typescript-eslint/no-explicit-any */
let invalidate_flag_cache: () => void;

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
  ({ classify_internal_transfers_orchestrator: classify } = require('../src/functions/orchestrators/plaid/classify_internal_transfers.orchestrator'));
  ({ invalidate_flag_cache } = require('../src/functions/infrastructure/feature_flags'));
  /* eslint-enable @typescript-eslint/no-var-requires */
  await seedMonthlySourcePeriods(db, [[2037, 4], [2037, 5], [2037, 6], [2037, 7], [2037, 8], [2037, 9], [2037, 10], [2037, 11], [2037, 12], [2038, 1]]);
}, 60000);
afterAll(() => jest.useRealTimers());

const OCT = { start: Date.UTC(2037, 9, 1), end: Date.UTC(2037, 10, 1) - 1 };

async function twin(tag: string, flag_on_after_link: boolean) {
  const ids = scenarioIds(tag);
  await seedScenario(db, ids);
  const mocks = scenarioMocks(ids);
  mockSync.mockReset();
  mockSync.mockImplementation(mocks.sync);
  mockRecurring.mockReset();
  mockRecurring.mockResolvedValue(scenarioRecurring(ids));
  const sync = (n: string) => sync_item_orchestrator({ trace_id: `${tag}_${n}`, span_id: 's' }, {
    item_doc_id: ids.itemDocId, user_id: ids.userId, recurring: true, reason: 'test',
  });
  await sync('link'); // flag off for everyone at link time → old records

  const flags = (await db.collection('_feature_flags').doc('convert_to_recurring_v1').get()).data();
  const allow = new Set<string>((flags?.enabled_user_ids as string[]) ?? []);
  if (flag_on_after_link) allow.add(ids.userId);
  await db.collection('_feature_flags').doc('convert_to_recurring_v1').set({
    enabled: true, enabled_user_ids: [...allow], enabled_group_ids: [], rollout_percentage: 0,
  });
  invalidate_flag_cache();

  // Every capture-rule path, on old records only (no new stream ids).
  const recurring = scenarioRecurring(ids, {
    SPOT: { is_active: false },
    TOMB: { status: 'UNKNOWN', frequency: 'UNKNOWN' },
    SUNBIT: { status: 'EARLY_DETECTION' },
  });
  recurring.outflow_streams = recurring.outflow_streams
    .filter((s) => s.stream_id !== ids.streams.GYM) // Plaid stops returning it → stale (today)
    .map((s) => (s.stream_id === ids.streams.AVANT ? { ...s, first_date: '2038-01-01' } : s)); // rejected
  mockRecurring.mockResolvedValue(recurring);
  const new_spot = plaidTxn(ids, { key: 'spotnew', account: 'chk', amount: 15.49, days_ago: 1, name: 'SPOTIFY USA',
    merchant: 'Spotify', primary: 'ENTERTAINMENT', detailed: 'ENTERTAINMENT_MUSIC_AND_AUDIO' });
  mockSync.mockImplementation(async (_t: string, cursor: string | null) => ({
    added: cursor === 'c1' ? [new_spot] : [], modified: [], removed: [],
    next_cursor: cursor === 'c1' ? 'c2' : cursor, has_more: false,
    transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE', accounts: [], request_id: 'r',
  }));
  await sync('changes');
  await classify({ trace_id: `${tag}_cls`, span_id: 's' }, ids.userId, NOW_MS, { force: true });

  const dump = await dumpScenario(db, ids);
  const derive = normalizeDoc(await derive_period_orchestrator({ trace_id: `${tag}_d`, span_id: 's' }, ids.userId, {
    view_cadence: 'monthly', window_start_ms: OCT.start, window_end_ms: OCT.end, force: true,
  }), tag);
  return { ids, dump, derive };
}

describe('legacy records are frozen with the flag on (emulator)', () => {
  it('flag-on twin equals flag-off twin on every path; no review items about old records', async () => {
    const a = await twin('qzfrza', true);
    const b = await twin('qzfrzb', false);
    // The flag-on twin's ONLY extras are new-feature bookkeeping, not record changes: today's
    // possible-bill detector job and its throttle (the state doc). Every record, period and
    // transaction — and the derived page — is identical.
    const { job_types: ja, review_state_exists: sa, ...ra } = a.dump;
    const { job_types: jb, review_state_exists: sb, ...rb } = b.dump;
    expect(ra).toEqual(rb);
    expect(a.derive).toEqual(b.derive);
    expect([ja, sa, jb, sb]).toEqual([['detect_possible_recurring'], true, [], false]);
    expect(a.dump.review_items).toBe(0);
    // Sanity: today's behavior really happened on both (the gym, saved inactive at link, isn't a
    // stale candidate; Spotify follows Plaid to inactive; rejected Avant is stale-marked; no v2
    // fields on any record).
    const outflows = a.dump.outflows as Record<string, Record<string, unknown>>;
    expect(outflows.TAG_S_GYM.isActive).toBe(false);
    expect(outflows.TAG_S_SPOT.isActive).toBe(false);
    expect(outflows.TAG_S_AVANT.plaidStatus).toBe('STALE');
    for (const o of Object.values(outflows)) {
      expect(o.captureRulesVersion).toBeUndefined();
      expect(o.plaidIsActive).toBeUndefined();
    }
  }, 180000);
});
