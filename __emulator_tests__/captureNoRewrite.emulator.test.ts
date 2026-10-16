/**
 * Emulator — T1 "no rewrites" (Convert-To-Recurring X1).
 *
 * The sync rebuilds every bill / income doc from a fixed field list and skips the write only when
 * the rebuilt doc equals the stored one. Every new field must therefore be PRESERVED (conditional
 * spread) or each sync would rewrite the record, fan out triggers and force an FE re-derive
 * (+20–60K reads/day per flipping bill). This suite:
 *   1. first link (flag off) → old records;
 *   2. gives some of them every new field (v2 stamp, plaidIsActive, a "Still a bill" answer, a
 *      merge marker, an "It ended" interval, a user-picked schedule) — as Phase 1 leaves them;
 *   3. runs 5 identical syncs with the flag OFF and 5 with it ON: after each, 0 bill / income
 *      writes, 0 `_audit`, 0 derive-version bumps — and every field is still there.
 * Also: old docs get 0 extra writes on the first post-deploy sync (step 3's first run).
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern captureNoRewrite"
 */
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import {
  NOW_MS, scenarioIds, scenarioMocks, scenarioRecurring, seedMonthlySourcePeriods, seedScenario,
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

let db: FirebaseFirestore.Firestore;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sync_item_orchestrator: (ctx: unknown, input: unknown) => Promise<any>;
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
  ({ invalidate_flag_cache } = require('../src/functions/infrastructure/feature_flags'));
  /* eslint-enable @typescript-eslint/no-var-requires */
  await seedMonthlySourcePeriods(db, [[2037, 4], [2037, 5], [2037, 6], [2037, 7], [2037, 8], [2037, 9], [2037, 10], [2037, 11], [2037, 12], [2038, 1]]);
}, 60000);
afterAll(() => jest.useRealTimers());

const NEW_FIELDS = ['captureRulesVersion', 'plaidIsActive', 'plaidInactiveAckAt', 'mergedIntoId', 'userFrequency', 'removalIntervals'];

describe('T1 — repeated syncs rewrite nothing (emulator)', () => {
  it('5 syncs flag off + 5 flag on → 0 bill/income writes, 0 audit, 0 bumps; every new field kept', async () => {
    const ids = scenarioIds('qznorw');
    await seedScenario(db, ids);
    const mocks = scenarioMocks(ids);
    mockSync.mockImplementation(mocks.sync);
    mockRecurring.mockResolvedValue(scenarioRecurring(ids));
    await db.collection(process.env.FEATURE_FLAGS_COLLECTION_OVERRIDE ?? '_feature_flags').doc('convert_to_recurring_v1').delete();
    invalidate_flag_cache();
    const sync = (n: string) =>
      sync_item_orchestrator({ trace_id: `qznorw_${n}`, span_id: 's' }, {
        item_doc_id: ids.itemDocId, user_id: ids.userId, recurring: true, reason: 'test',
      });
    await sync('first');

    // Phase-1 states on existing records (what the planner / answers leave behind).
    const o = (s: string) => db.collection('outflows').doc(ids.streams[s]);
    const i = (s: string) => db.collection('inflows').doc(ids.streams[s]);
    const ack = Timestamp.fromMillis(NOW_MS - 86400000);
    const end_from = Date.UTC(2037, 10, 1);
    /* eslint-disable @typescript-eslint/naming-convention */
    await o('SPOT').update({ captureRulesVersion: 2, plaidIsActive: true });
    await o('CCPAY').update({ captureRulesVersion: 2, plaidIsActive: true, plaidInactiveAckAt: ack });
    await o('XFER').update({ mergedIntoId: 'some_other_bill' });
    await o('AVANT').update({
      captureRulesVersion: 2, plaidIsActive: true, userFrequency: 'monthly',
      removedByUser: true, removalIntervals: [{ fromMs: end_from, toMs: null, mode: 'going_forward' }],
    });
    await i('PAY').update({ captureRulesVersion: 2, plaidIsActive: true });
    /* eslint-enable @typescript-eslint/naming-convention */
    const snapshot = async () => {
      const out: Record<string, Record<string, unknown>> = {};
      for (const s of ['SPOT', 'CCPAY', 'XFER', 'AVANT', 'SUNBIT', 'GYM']) out[s] = (await o(s).get()).data()!;
      out.PAY = (await i('PAY').get()).data()!;
      return out;
    };
    const before = await snapshot();

    const per_run: Array<Record<string, number>> = [];
    const run = async (label: string) => {
      const c = startCounting();
      await sync(label);
      await new Promise((r) => setTimeout(r, 400)); // let fire-and-forget audit writes land
      const counts = c.stop();
      per_run.push({
        outflows: counts.writes_by.outflows ?? 0,
        inflows: counts.writes_by.inflows ?? 0,
        audit: counts.writes_by._audit ?? 0,
        bumps: counts.writes_by.user_data_versions ?? 0,
        periods: (counts.writes_by.outflow_periods ?? 0) + (counts.writes_by.inflow_periods ?? 0),
        transactions: counts.writes_by.transactions ?? 0,
        reads: counts.reads,
      });
    };
    for (let n = 0; n < 5; n++) await run(`off${n}`);

    await db.collection(process.env.FEATURE_FLAGS_COLLECTION_OVERRIDE ?? '_feature_flags').doc('convert_to_recurring_v1').set({
      enabled: true, enabled_user_ids: [ids.userId], enabled_group_ids: [], rollout_percentage: 0,
    });
    invalidate_flag_cache();
    for (let n = 0; n < 5; n++) await run(`on${n}`);

    console.log('[T1] per-run writes:', JSON.stringify(per_run));
    for (const r of per_run) {
      expect({ ...r, reads: 0 }).toEqual({ outflows: 0, inflows: 0, audit: 0, bumps: 0, periods: 0, transactions: 0, reads: 0 });
    }
    // Every new field survives all 10 syncs, byte-for-byte (sync timestamps aside).
    const after = await snapshot();
    for (const s of Object.keys(before)) {
      for (const f of NEW_FIELDS) {
        expect([s, f, after[s][f]]).toEqual([s, f, before[s][f]]);
      }
    }
  }, 180000);
});
