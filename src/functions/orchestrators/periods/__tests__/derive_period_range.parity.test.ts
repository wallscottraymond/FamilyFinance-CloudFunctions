/**
 * derive_period_range PARITY — proves the range call returns, for EVERY window, exactly what
 * `derive_period` + `derive_goals_view` return for that window alone.
 *
 * Repositories are mocked with the SAME query semantics as Firestore (inclusive Timestamp ranges,
 * the get_overlapping 31-day startDate buffer, `in` chunking, result ordering), over a year of
 * fixture data built to hit the edges: an internal-transfer pair straddling a month boundary,
 * Plaid-stream-linked vs split-linked bill payments, semi-monthly income with history, "other"
 * income, pending + inactive transactions, a budget created mid-range (snapped start), missing
 * materialized budget periods (synthesized), weekly periods interleaved with monthly ones, a paused
 * bill, and goals with balance snapshots.
 *
 * Set DUMP_DERIVE_PARITY=<file> to write the single-window outputs as JSON (used to prove
 * `derive_period` itself is unchanged vs the pre-refactor commit).
 */
import { Timestamp } from "firebase-admin/firestore";
import * as fs from "fs";

/* eslint-disable @typescript-eslint/naming-convention */
const DAY = 24 * 60 * 60 * 1000;
const UID = "user_1";

// ---------------------------------------------------------------------------------------------
// Fixture store (names prefixed `mock` so jest.mock factories may reference them)
// ---------------------------------------------------------------------------------------------
interface MockPeriod {
  id: string;
  period_id: string;
  period_type: "weekly" | "monthly" | "bi_monthly";
  start_date: Timestamp;
  end_date: Timestamp;
  year: number;
  index: number;
}
const mockStore: {
  periods: MockPeriod[];
  budgets: any[];
  budget_periods: any[];
  outflows: any[];
  inflows: any[];
  goals: any[];
  txns: Array<{ id: string; data: Record<string, unknown> }>;
  snapshots: Array<{ accountId: string; ts: Timestamp; currentBalance: number }>;
  cache: Map<string, any>;
  calls: Record<string, number>;
  /** Emulate the periodStart-bounded budget-period query (true) or return all (old load). */
  scope_budget_periods: boolean;
} = {
  periods: [],
  budgets: [],
  budget_periods: [],
  outflows: [],
  inflows: [],
  goals: [],
  txns: [],
  snapshots: [],
  cache: new Map(),
  calls: {},
  scope_budget_periods: true,
};
const mockCount = (k: string): void => {
  mockStore.calls[k] = (mockStore.calls[k] ?? 0) + 1;
};
const mockTsCmp = (a: Timestamp, b: Timestamp): number =>
  a.seconds !== b.seconds ? a.seconds - b.seconds : a.nanoseconds - b.nanoseconds;

jest.mock("../../../observability", () => ({
  create_span: () => ({ span_id: "s", trace_id: "t" }),
  create_trace_context: () => ({ trace_id: "t", span_id: "s" }),
  log_operation_start: () => undefined,
  log_operation_success: () => undefined,
  log_operation_error: () => undefined,
  fire_and_forget: (fn: () => Promise<unknown>) => {
    void fn().catch(() => undefined);
  },
  log_async_debug: async () => undefined,
}));

jest.mock("../../../repositories/source_period.repo", () => ({
  SOURCE_PERIOD_OVERLAP_BUFFER_MS: 31 * 24 * 60 * 60 * 1000,
  source_period_repo: {
    get_overlapping: async (_ctx: unknown, anchor: Timestamp, end: Timestamp) => {
      mockCount("get_overlapping");
      const lower = Timestamp.fromMillis(anchor.toMillis() - 31 * 24 * 60 * 60 * 1000);
      return mockStore.periods
        .filter((p) => mockTsCmp(p.start_date, lower) >= 0 && mockTsCmp(p.start_date, end) <= 0)
        .sort((a, b) => mockTsCmp(a.start_date, b.start_date) || (a.id < b.id ? -1 : 1))
        .filter((p) => p.end_date.toMillis() >= anchor.toMillis());
    },
    get_by_id: async (_ctx: unknown, id: string) =>
      mockStore.periods.find((p) => p.id === id) ?? null,
  },
}));
jest.mock("../../../repositories/budget.repo", () => ({
  budget_repo: {
    get_by_user_id: async () => {
      mockCount("budgets");
      return mockStore.budgets;
    },
  },
}));
jest.mock("../../../repositories/budget_period.repo", () => ({
  budget_period_repo: {
    get_by_user_and_type: async () => {
      mockCount("budget_periods");
      return mockStore.budget_periods;
    },
    // Read-Cost-Review-Round-3 #5: emulates the periodStart-bounded query (Firestore semantics).
    get_by_user_and_type_starting_between: async (
      _c: unknown, _u: string, _t: string, lo: number, hi: number
    ) => {
      mockCount("budget_periods");
      const kept = mockStore.budget_periods.filter(
        (p: { start_date: Timestamp }) =>
          !mockStore.scope_budget_periods ||
          (p.start_date.toMillis() >= lo && p.start_date.toMillis() <= hi)
      );
      mockStore.calls.budget_periods_excluded =
        (mockStore.calls.budget_periods_excluded ?? 0) + mockStore.budget_periods.length - kept.length;
      return kept;
    },
  },
}));
jest.mock("../../../repositories/outflow.repo", () => ({
  outflow_repo: {
    get_by_user_id: async () => {
      mockCount("outflows");
      return mockStore.outflows;
    },
  },
}));
jest.mock("../../../repositories/inflow.repo", () => ({
  inflow_repo: {
    get_by_user_id: async () => {
      mockCount("inflows");
      return mockStore.inflows;
    },
  },
}));
jest.mock("../../../repositories/goal.repo", () => ({
  goal_repo: {
    get_by_user: async () => {
      mockCount("goals");
      return mockStore.goals;
    },
  },
}));
jest.mock("../../../repositories/balance_snapshot.repo", () => ({
  balance_snapshot_repo: {
    get_at_or_before: async (account_id: string, ts: Timestamp) => {
      const hits = mockStore.snapshots
        .filter((s) => s.accountId === account_id && mockTsCmp(s.ts, ts) <= 0)
        .sort((a, b) => mockTsCmp(b.ts, a.ts));
      return hits[0] ?? null;
    },
  },
}));
jest.mock("../../../repositories/transaction.repo", () => ({
  transaction_repo: {
    get_active_in_date_range: async (
      _ctx: unknown,
      user_id: string,
      start_ms: number,
      end_ms: number
    ) => {
      mockCount("txn_range");
      const lo = Timestamp.fromMillis(start_ms);
      const hi = Timestamp.fromMillis(end_ms);
      return mockStore.txns
        .filter((t) => t.data.userId === user_id)
        .filter((t) => {
          const d = t.data.transactionDate as Timestamp;
          return mockTsCmp(d, lo) >= 0 && mockTsCmp(d, hi) <= 0;
        })
        .sort(
          (a, b) =>
            mockTsCmp(a.data.transactionDate as Timestamp, b.data.transactionDate as Timestamp) ||
            (a.id < b.id ? -1 : 1)
        )
        .map((t) => ({ id: t.id, data: { ...t.data } }))
        .filter((t) => t.data.isActive !== false);
    },
    get_by_plaid_transaction_ids: async (_ctx: unknown, user_id: string, ids: string[]) => {
      mockCount("history");
      const out: any[] = [];
      for (let i = 0; i < ids.length; i += 30) {
        const chunk = new Set(ids.slice(i, i + 30));
        const docs = mockStore.txns
          .filter((t) => chunk.has(t.data.transactionId as string))
          .sort((a, b) => (a.id < b.id ? -1 : 1));
        for (const t of docs) if (t.data.ownerId === user_id) out.push({ ...t.data, id: t.id });
      }
      return out;
    },
  },
}));
// Account-Rooted-Sharing: the Me scope reads the user's group list; a user in no groups takes
// the fast path (no shared accounts), which is exactly this single-user parity fixture.
jest.mock("../../../repositories/user.repo", () => ({
  user_repo: { get_by_id: jest.fn(async () => ({ id: "u1", data: {} })) },
}));
jest.mock("../../../repositories/derive_version.repo", () => ({
  get_derive_version: async () => 7,
}));
jest.mock("../../../repositories/derive_period_cache.repo", () => ({
  get_cached_derived_period: async (u: string, c: string, s: number, e: number) =>
    mockStore.cache.get(`${u}|${c}|${s}|${e}`) ?? null,
  put_cached_derived_period: async () => undefined,
}));

import { derive_period_orchestrator } from "../derive_period.orchestrator";
import { derive_period_range_orchestrator } from "../derive_period_range.orchestrator";
import { derive_goals_view_orchestrator } from "../../goals/derive_goals_view.orchestrator";

// ---------------------------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------------------------
const ts = (ms: number): Timestamp => Timestamp.fromMillis(ms);
const utc = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d);
const ctx = { trace_id: "t", span_id: "s" };

function build_periods(): void {
  // Monthly: 2025-09 .. 2026-11
  for (let i = 0; i < 15; i++) {
    const y = 2025 + Math.floor((8 + i) / 12);
    const m = ((8 + i) % 12) + 1;
    const start = utc(y, m, 1);
    const end = utc(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - 1;
    const id = `${y}M${String(m).padStart(2, "0")}`;
    mockStore.periods.push({
      id, period_id: id, period_type: "monthly", start_date: ts(start), end_date: ts(end),
      year: y, index: y * 100 + m,
    });
  }
  // Weekly (Sunday starts): 2025-08-31 .. ~2026-11
  let w = utc(2025, 8, 31);
  for (let i = 0; i < 66; i++) {
    const id = `W${i}`;
    mockStore.periods.push({
      id, period_id: id, period_type: "weekly", start_date: ts(w), end_date: ts(w + 7 * DAY - 1),
      year: new Date(w).getUTCFullYear(), index: i,
    });
    w += 7 * DAY;
  }
}

let txn_seq = 0;
function txn(
  date_ms: number,
  amount: number,
  opts: Partial<{
    category: string; type: string; transactionId: string; accountId: string;
    outflowId: string | null; inflowId: string | null; isPending: boolean; isActive: boolean;
    firstCategoryId: string; spendStatus: string; extraSplit: number;
  }> = {}
): void {
  txn_seq += 1;
  const id = `txn_${String(txn_seq).padStart(4, "0")}`;
  const split = (amt: number, sid: string): Record<string, unknown> => ({
    splitId: sid,
    amount: amt,
    plaidDetailedCategory: opts.category ?? "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
    firstCategoryId: opts.firstCategoryId ?? null,
    outflowId: opts.outflowId ?? null,
    inflowId: opts.inflowId ?? null,
    spendStatus: opts.spendStatus,
  });
  const splits = [split(amount, `${id}_s1`)];
  if (opts.extraSplit) splits.push(split(opts.extraSplit, `${id}_s2`));
  mockStore.txns.push({
    id,
    data: {
      userId: UID,
      ownerId: UID,
      transactionDate: ts(date_ms + 12 * 60 * 60 * 1000 + (txn_seq % 7) * 1000),
      transactionId: opts.transactionId ?? `plaid_${id}`,
      accountId: opts.accountId ?? "acc_chk",
      type: opts.type ?? "expense",
      isPending: opts.isPending ?? false,
      isActive: opts.isActive ?? true,
      plaidDetailedCategory: opts.category ?? "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
      splits,
    },
  });
}

function build_fixture(): void {
  build_periods();
  // Budgets: EE (monthly home) + weekly EE (dropped as non-canonical), Groceries from the start,
  // Dining created MID-range (2026-02-17 → snapped start), a non-ongoing budget ending 2026-06.
  mockStore.budgets = [
    { id: "b_ee", name: "Everything Else", is_system_everything_else: true, period: "monthly",
      start_date: ts(0), end_date: ts(0), is_ongoing: true, category_ids: [], amount: 0 },
    { id: "b_ee_w", name: "Everything Else", is_system_everything_else: true, period: "weekly",
      start_date: ts(0), end_date: ts(0), is_ongoing: true, category_ids: [], amount: 0 },
    { id: "b_groc", name: "Groceries", is_system_everything_else: false, period: "monthly",
      start_date: ts(utc(2025, 1, 1)), end_date: ts(0), is_ongoing: true,
      category_ids: ["FOOD_AND_DRINK_GROCERIES"], amount: 600 },
    { id: "b_dine", name: "Dining", is_system_everything_else: false, period: "monthly",
      start_date: ts(utc(2026, 2, 17)), end_date: ts(0), is_ongoing: true,
      category_ids: ["FOOD_AND_DRINK_RESTAURANT"], amount: 250 },
    { id: "b_trip", name: "Trip", is_system_everything_else: false, period: "weekly",
      start_date: ts(utc(2025, 11, 3)), end_date: ts(utc(2026, 6, 30)), is_ongoing: false,
      category_ids: ["TRAVEL_FLIGHTS"], amount: 50 },
  ];
  // Materialized monthly periods for Groceries only on some months (others synthesize).
  for (const m of [10, 11, 12]) {
    mockStore.budget_periods.push({
      budget_id: "b_groc", allocated_amount: 600, effective_amount: 640,
      start_date: ts(utc(2025, m, 1)), end_date: ts(utc(m === 12 ? 2026 : 2025, m === 12 ? 1 : m + 1, 1) - 1),
    });
  }
  // Bills: rent (split-linked some months, stream-linked others), gym (paused Mar–Apr), an
  // internal transfer "bill" stream (excluded), a hidden one.
  const rent_stream: string[] = [];
  const gym_stream: string[] = [];
  const xfer_stream: string[] = [];
  const pay_stream: string[] = [];
  // Income: semi-monthly paycheck, Plaid-stream linked.
  for (let i = 0; i < 14; i++) {
    const y = 2025 + Math.floor((8 + i) / 12);
    const m = ((8 + i) % 12) + 1;
    // rent on the 1st
    const rent_pid = `plaid_rent_${y}_${m}`;
    rent_stream.push(rent_pid);
    txn(utc(y, m, 1), 1800, {
      category: "RENT_AND_UTILITIES_RENT", transactionId: rent_pid,
      outflowId: i % 2 === 0 ? "o_rent" : null,
    });
    // gym on the 5th
    const gym_pid = `plaid_gym_${y}_${m}`;
    gym_stream.push(gym_pid);
    txn(utc(y, m, 5), 45, { category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS", transactionId: gym_pid });
    // paychecks on the 15th and last day
    for (const d of [15, new Date(utc(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - DAY).getUTCDate()]) {
      const pid = `plaid_pay_${y}_${m}_${d}`;
      pay_stream.push(pid);
      txn(utc(y, m, d), -(2400 + (d > 15 ? 150 : 0) + i), {
        category: "INCOME_WAGES", type: "income", transactionId: pid,
      });
    }
    // groceries weekly-ish
    for (const d of [3, 10, 17, 24]) {
      txn(utc(y, m, d), 90 + ((i * 7 + d) % 40), {
        category: "FOOD_AND_DRINK_GROCERIES", firstCategoryId: "FOOD_AND_DRINK_GROCERIES",
        isPending: d === 24 && i === 12,
      });
    }
    // dining
    txn(utc(y, m, 20), 60 + i, {
      category: "FOOD_AND_DRINK_RESTAURANT", firstCategoryId: "FOOD_AND_DRINK_RESTAURANT",
      extraSplit: i % 3 === 0 ? 12 : 0,
    });
    // savings transfer stream (internal pair each month, same day)
    const xpid = `plaid_xfer_${y}_${m}`;
    xfer_stream.push(xpid);
    txn(utc(y, m, 8), 300, { category: "TRANSFER_OUT_ACCOUNT_TRANSFER", transactionId: xpid });
    txn(utc(y, m, 8), -300, {
      category: "TRANSFER_IN_ACCOUNT_TRANSFER", accountId: "acc_sav", type: "income",
    });
    // an ignored + a refund split, and an inactive txn
    txn(utc(y, m, 12), 25, { category: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES", spendStatus: "ignored" });
    txn(utc(y, m, 13), -40, { category: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES", spendStatus: "refund" });
    txn(utc(y, m, 14), 999, { isActive: false });
  }
  // Other income (bonus) not in any stream.
  txn(utc(2026, 3, 22), -1200, { category: "INCOME_OTHER_INCOME", type: "income" });
  // Internal transfer pair STRADDLING a month boundary (Jan 31 out → Feb 1 in, other account).
  txn(utc(2026, 1, 31), 500, { category: "TRANSFER_OUT_ACCOUNT_TRANSFER" });
  txn(utc(2026, 2, 1), -500, { category: "TRANSFER_IN_ACCOUNT_TRANSFER", accountId: "acc_sav", type: "income" });
  // Flights (for the non-ongoing weekly budget).
  txn(utc(2026, 4, 9), 420, { category: "TRAVEL_FLIGHTS", firstCategoryId: "TRAVEL_FLIGHTS" });

  const tsd = (y: number, m: number, d: number): Timestamp => ts(utc(y, m, d));
  mockStore.outflows = [
    { id: "o_rent", is_active: true, is_hidden: false, plaid_detailed_category: "RENT_AND_UTILITIES_RENT",
      transaction_ids: rent_stream, user_custom_name: "Rent", merchant_name: "Landlord", description: "Rent",
      frequency: "MONTHLY", expected_amount_override: null, average_amount: 1800,
      first_date: tsd(2025, 1, 1), last_date: tsd(2026, 10, 1), predicted_next_date: tsd(2026, 11, 1),
      removal_intervals: [] },
    { id: "o_gym", is_active: true, is_hidden: false, plaid_detailed_category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
      transaction_ids: gym_stream, user_custom_name: null, merchant_name: "Gym", description: "Gym",
      frequency: "MONTHLY", expected_amount_override: 50, average_amount: 45,
      first_date: tsd(2025, 1, 5), last_date: tsd(2026, 10, 5), predicted_next_date: tsd(2026, 11, 5),
      removal_intervals: [{ from_ms: utc(2026, 3, 1) - 1, to_ms: utc(2026, 5, 1) - 1, mode: "paused" }] },
    { id: "o_xfer", is_active: true, is_hidden: false, plaid_detailed_category: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      transaction_ids: xfer_stream, user_custom_name: "Savings", merchant_name: null, description: "Xfer",
      frequency: "MONTHLY", expected_amount_override: null, average_amount: 300,
      first_date: tsd(2025, 1, 8), last_date: tsd(2026, 10, 8), predicted_next_date: tsd(2026, 11, 8),
      removal_intervals: [] },
    { id: "o_hidden", is_active: true, is_hidden: true, plaid_detailed_category: "OTHER",
      transaction_ids: [], user_custom_name: "Hidden", merchant_name: null, description: "h",
      frequency: "MONTHLY", expected_amount_override: null, average_amount: 10,
      first_date: tsd(2025, 1, 1), last_date: tsd(2026, 10, 1), predicted_next_date: null,
      removal_intervals: [] },
  ];
  mockStore.inflows = [
    { id: "i_pay", is_active: true, is_hidden: false, plaid_detailed_category: "INCOME_WAGES",
      transaction_ids: pay_stream, user_custom_name: "Paycheck", payer_name: "Employer", description: "Pay",
      frequency: "SEMIMONTHLY", expected_amount_override: null, average_amount: 2475,
      occurrence_amount_overrides: { "2026-03-15": 2600 },
      first_date: tsd(2025, 1, 15), last_date: tsd(2026, 10, 31), predicted_next_date: tsd(2026, 11, 15),
      removal_intervals: [] },
  ];
  mockStore.goals = [
    { id: "g_emerg", name: "Emergency", goal_type: "save", status: "active", draws_income: true,
      per_period_amount: 400, home_cadence: "monthly", linked_account_id: "acc_sav",
      target_amount: 10000, priority_rank: 1, baseline_balance: 2000, baseline_counts_existing: false },
    { id: "g_car", name: "Car", goal_type: "save", status: "paused", draws_income: true,
      per_period_amount: 200, home_cadence: "monthly", linked_account_id: "acc_sav",
      target_amount: 5000, priority_rank: 2, baseline_balance: 2000, baseline_counts_existing: false },
  ];
  // Savings balance snapshots, one per ~2 weeks, growing.
  for (let i = 0; i < 32; i++) {
    mockStore.snapshots.push({
      accountId: "acc_sav", ts: ts(utc(2025, 9, 1) + i * 14 * DAY), currentBalance: 2000 + i * 180,
    });
  }
}

const monthly_windows = (): Array<{ period_id: string; start_ms: number; end_ms: number }> =>
  mockStore.periods
    .filter((p) => p.period_type === "monthly")
    .filter((p) => p.start_date.toMillis() >= utc(2025, 10, 1) && p.start_date.toMillis() <= utc(2026, 10, 1))
    .map((p) => ({ period_id: p.period_id, start_ms: p.start_date.toMillis(), end_ms: p.end_date.toMillis() }));

const weekly_windows = (): Array<{ period_id: string; start_ms: number; end_ms: number }> =>
  mockStore.periods
    .filter((p) => p.period_type === "weekly")
    .slice(20, 32)
    .map((p) => ({ period_id: p.period_id, start_ms: p.start_date.toMillis(), end_ms: p.end_date.toMillis() }));

// JSON round-trip mirrors what the callable ships (drops undefined, keeps Timestamps comparable).
const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

beforeAll(() => build_fixture());
beforeEach(() => {
  mockStore.calls = {};
  mockStore.cache.clear();
});

describe("derive_period_range parity", () => {
  it.each([
    ["monthly (13 windows)", "monthly" as const, monthly_windows],
    ["weekly (12 windows)", "weekly" as const, weekly_windows],
  ])("%s: every window equals derive_period + derive_goals_view", async (_label, cadence, make) => {
    const windows = make();
    const singles: unknown[] = [];
    const single_goals: unknown[] = [];
    for (const w of windows) {
      singles.push(
        wire(await derive_period_orchestrator(ctx, UID, {
          view_cadence: cadence, window_start_ms: w.start_ms, window_end_ms: w.end_ms,
        }))
      );
      single_goals.push(wire(await derive_goals_view_orchestrator(ctx, UID, w.period_id)));
    }

    mockStore.calls = {};
    const range = await derive_period_range_orchestrator(ctx, UID, { view_cadence: cadence, windows });

    expect(range.windows.map((w) => w.period_id)).toEqual(windows.map((w) => w.period_id));
    range.windows.forEach((rw, i) => {
      expect(wire(rw.derive)).toEqual(singles[i]);
      expect(wire(rw.goals)).toEqual(single_goals[i]);
      expect(rw.from_cache).toBe(false);
    });

    // Loaded ONCE for the whole range, not per window.
    expect(mockStore.calls.txn_range).toBe(1);
    expect(mockStore.calls.budgets).toBe(1);
    expect(mockStore.calls.outflows).toBe(1);
    expect(mockStore.calls.inflows).toBe(1);
    expect(mockStore.calls.history).toBe(1);
    expect(mockStore.calls.goals).toBe(2); // once for derivation (EE leftover), once for goal views

    if (process.env.DUMP_DERIVE_PARITY) {
      const f = `${process.env.DUMP_DERIVE_PARITY}.${cadence}.json`;
      fs.writeFileSync(f, JSON.stringify({ singles, single_goals }, null, 1));
    }
  });

  // Read-Cost-Review-Round-3 #5: loading only periodStart-bounded budget periods must not change
  // a single derived number vs loading all of the user's monthly periods (the old query).
  it.each([
    ["monthly", "monthly" as const, monthly_windows],
    ["weekly", "weekly" as const, weekly_windows],
  ])("%s: scoped budget-period load == loading all (every window)", async (_l, cadence, make) => {
    const run = async (scoped: boolean) => {
      mockStore.scope_budget_periods = scoped;
      mockStore.cache.clear();
      const out: unknown[] = [];
      for (const w of make()) {
        out.push(wire(await derive_period_orchestrator(ctx, UID, {
          view_cadence: cadence, window_start_ms: w.start_ms, window_end_ms: w.end_ms,
        })));
      }
      return out;
    };
    const all = await run(false);
    mockStore.calls = {};
    const scoped = await run(true);
    mockStore.scope_budget_periods = true;
    expect(scoped).toEqual(all);
    // Meaningful: the scoped load really skipped periods outside the bounds.
    expect(mockStore.calls.budget_periods_excluded).toBeGreaterThan(0);
  });

  it("the fixture exercises the edge cases (non-trivial output)", async () => {
    const range = await derive_period_range_orchestrator(ctx, UID, {
      view_cadence: "monthly", windows: monthly_windows(),
    });
    const all = range.windows.map((w) => w.derive);
    const jan = all.find((_, i) => range.windows[i].period_id === "2026M01")!;
    const mar = all.find((_, i) => range.windows[i].period_id === "2026M03")!;
    expect(jan.budgets.some((b) => b.is_everything_else)).toBe(true);
    expect(jan.bills.some((b) => b.recurring_id === "o_rent")).toBe(true);
    expect(jan.bills.some((b) => b.recurring_id === "o_xfer")).toBe(false); // internal stream
    expect(mar.income.some((r) => r.recurring_id === "__other_income__")).toBe(true);
    expect(
      mar.bills.find((b) => b.recurring_id === "o_gym")?.groups.filter((g) => g.is_due_period) ?? []
    ).toHaveLength(0); // paused
    // Dining appears only from its (snapped) start month.
    const has_dining = range.windows.map((w, i) => [w.period_id, all[i].budgets.some((b) => b.budget_id === "b_dine")]);
    expect(has_dining.find(([p]) => p === "2026M01")?.[1]).toBe(false);
    expect(has_dining.find(([p]) => p === "2026M02")?.[1]).toBe(true);
    expect(range.windows.every((w) => w.goals !== null)).toBe(true);
  });

  it("serves version-matched cached windows and derives only the misses", async () => {
    const windows = monthly_windows();
    const first = await derive_period_orchestrator(ctx, UID, {
      view_cadence: "monthly", window_start_ms: windows[0].start_ms, window_end_ms: windows[0].end_ms,
    });
    mockStore.cache.set(`${UID}|monthly|${windows[0].start_ms}|${windows[0].end_ms}`, {
      data_version: 7, computed_at_ms: Date.now(), result: first,
    });
    // A stale-version entry must NOT be served.
    mockStore.cache.set(`${UID}|monthly|${windows[1].start_ms}|${windows[1].end_ms}`, {
      data_version: 6, computed_at_ms: Date.now(), result: { bogus: true },
    });
    const range = await derive_period_range_orchestrator(ctx, UID, { view_cadence: "monthly", windows });
    expect(range.windows[0].from_cache).toBe(true);
    expect(range.windows[1].from_cache).toBe(false);
    expect((range.windows[1].derive as any).bogus).toBeUndefined();
    expect(range.windows.slice(1).every((w) => !w.from_cache)).toBe(true);
  });

  it("force recomputes every window", async () => {
    const windows = monthly_windows().slice(0, 2);
    mockStore.cache.set(`${UID}|monthly|${windows[0].start_ms}|${windows[0].end_ms}`, {
      data_version: 7, computed_at_ms: Date.now(), result: { bogus: true },
    });
    const range = await derive_period_range_orchestrator(ctx, UID, {
      view_cadence: "monthly", windows, force: true,
    });
    expect(range.windows.every((w) => !w.from_cache)).toBe(true);
  });

  it("returns goals: null for a period_id that isn't a real source period", async () => {
    const w = monthly_windows()[0];
    const range = await derive_period_range_orchestrator(ctx, UID, {
      view_cadence: "monthly", windows: [{ ...w, period_id: "NOT_A_PERIOD" }],
    });
    expect(range.windows[0].goals).toBeNull();
  });
});
