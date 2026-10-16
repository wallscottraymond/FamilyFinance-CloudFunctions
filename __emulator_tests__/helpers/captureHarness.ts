/**
 * captureHarness — shared driver for the Convert-To-Recurring capture-rules emulator suites.
 * The suite owns the jest.mock() of Plaid (hoisted); it hands its mock fns here.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-var-requires */
import { Firestore } from 'firebase-admin/firestore';
import {
  NOW_MS, ScenarioIds, plaidTxn, scenarioIds, scenarioMocks, scenarioRecurring, seedMonthlySourcePeriods, seedScenario,
} from './captureScenario';

export const FAKE_CLOCK = {
  now: NOW_MS,
  advanceTimers: true,
  doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] as any,
};

export const MONTHS: Array<[number, number]> = [
  [2026, 3], [2026, 4], [2026, 5], [2026, 6], [2026, 7], [2026, 8], [2026, 9], [2026, 10], [2026, 11], [2026, 12], [2027, 1],
];
export const OCT = { start: Date.UTC(2026, 9, 1), end: Date.UTC(2026, 10, 1) - 1 };
export const SEP = { start: Date.UTC(2026, 8, 1), end: Date.UTC(2026, 9, 1) - 1 };
export const NOV = { start: Date.UTC(2026, 10, 1), end: Date.UTC(2026, 11, 1) - 1 };

export interface Harness {
  db: Firestore;
  ids: ScenarioIds;
  sync: (label: string) => Promise<any>;
  /** Next sync returns these new transactions (posted unless `pending`). */
  postTxns: (txns: any[]) => void;
  /** Next sync reports these Plaid transaction ids removed (pending → posted). */
  removeTxns: (plaid_ids: string[]) => void;
  setRecurring: (r: any) => void;
  derive: (w: { start: number; end: number }) => Promise<any>;
  bill: (w: { start: number; end: number }, recurring_id: string) => Promise<any | undefined>;
  income: (w: { start: number; end: number }, recurring_id: string) => Promise<any | undefined>;
  eeSpent: (w: { start: number; end: number }) => Promise<number>;
  txn: (key: string) => Promise<any>;
}

export async function setFlag(db: Firestore, user_ids: string[]): Promise<void> {
  const ref = db.collection('_feature_flags').doc('convert_to_recurring_v1');
  const cur = (await ref.get()).data();
  const all = new Set<string>([...(((cur?.enabled_user_ids as string[]) ?? [])), ...user_ids]);
  await ref.set({ enabled: true, enabled_user_ids: [...all], enabled_group_ids: [], rollout_percentage: 0, description: 'test' });
  require('../../src/functions/infrastructure/feature_flags').invalidate_flag_cache();
}

export async function clearFlagFor(db: Firestore, user_id: string): Promise<void> {
  const ref = db.collection('_feature_flags').doc('convert_to_recurring_v1');
  const cur = (await ref.get()).data();
  const left = (((cur?.enabled_user_ids as string[]) ?? [])).filter((u) => u !== user_id);
  await ref.set({ enabled: true, enabled_user_ids: left, enabled_group_ids: [], rollout_percentage: 0 });
  require('../../src/functions/infrastructure/feature_flags').invalidate_flag_cache();
}

export async function seedMonths(db: Firestore): Promise<void> {
  await seedMonthlySourcePeriods(db, MONTHS);
}

/** Seed a scenario user and return a driver. Plaid mocks are reset to the scenario. */
export async function makeHarness(
  db: Firestore,
  tag: string,
  mocks: { mockSync: jest.Mock; mockRecurring: jest.Mock },
  opts: { recurring?: any; flag?: boolean } = {}
): Promise<Harness> {
  const ids = scenarioIds(tag);
  await seedScenario(db, ids);
  if (opts.flag) await setFlag(db, [ids.userId]);
  const base = scenarioMocks(ids);
  let pending: any[] = base.txns;
  let removed: string[] = [];
  let cursor_n = 0;
  let recurring = opts.recurring ?? scenarioRecurring(ids);
  const { sync_item_orchestrator } = require('../../src/functions/orchestrators/plaid/sync_item.orchestrator');
  const { derive_period_orchestrator } = require('../../src/functions/orchestrators/periods/derive_period.orchestrator');
  const install = () => {
    mocks.mockSync.mockReset();
    mocks.mockSync.mockImplementation(async () => {
      const added = pending;
      pending = [];
      const gone = removed.map((transaction_id) => ({ transaction_id }));
      removed = [];
      cursor_n++;
      return {
        added, modified: [], removed: gone, next_cursor: `c${cursor_n}`, has_more: false,
        transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE', accounts: [], request_id: 'r',
      };
    });
    mocks.mockRecurring.mockReset();
    mocks.mockRecurring.mockImplementation(async () => recurring);
  };
  install();
  const derive = (w: { start: number; end: number }) =>
    derive_period_orchestrator({ trace_id: `${tag}_d_${Math.random()}`, span_id: 's' }, ids.userId, {
      view_cadence: 'monthly', window_start_ms: w.start, window_end_ms: w.end, force: true,
    });
  return {
    db,
    ids,
    sync: async (label: string) => {
      install();
      return sync_item_orchestrator({ trace_id: `${tag}_${label}`, span_id: 's' }, {
        item_doc_id: ids.itemDocId, user_id: ids.userId, recurring: true, reason: 'test',
      });
    },
    postTxns: (txns: any[]) => { pending = [...pending, ...txns]; },
    removeTxns: (plaid_ids: string[]) => { removed = [...removed, ...plaid_ids]; },
    setRecurring: (r: any) => { recurring = r; },
    derive,
    bill: async (w, id) => (await derive(w)).bills.find((b: any) => b.recurring_id === id),
    income: async (w, id) => (await derive(w)).income.find((b: any) => b.recurring_id === id),
    eeSpent: async (w) => {
      const r = await derive(w);
      return Math.round(r.budgets.reduce((s: number, b: any) =>
        s + b.periods.reduce((x: number, p: any) => x + (p.spent ?? 0), 0), 0) * 100) / 100;
    },
    txn: async (key: string) => (await db.collection('transactions').doc(`plaid_${ids.txn(key)}`).get()).data(),
  };
}

export const paidTotal = (bill: any): number =>
  Math.round(((bill?.groups ?? []).reduce((s: number, g: any) => s + (g.total_paid ?? 0), 0)) * 100) / 100;
export const expectedTotal = (bill: any): number =>
  Math.round(((bill?.groups ?? []).reduce((s: number, g: any) => s + (g.total_due ?? 0), 0)) * 100) / 100;

export { plaidTxn, scenarioRecurring };
