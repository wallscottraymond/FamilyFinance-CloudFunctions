/**
 * Emulator Integration Test — budget pause end to end (Code-Health-Review M1-M1, PZ1–PZ6).
 *
 * Groceries ($600/month = $20/day in November 2031) with purchases on Nov 4 ($50, a paused day)
 * and Nov 20 ($30). Pausing the week Nov 2–8 through the real `set_budget_pause` orchestrator:
 *   - weekly page: that week shows Groceries Paused · $0 · spent 0; Everything Else spent +50
 *   - monthly page: Groceries $460 (7 days' share out), spent 30, Partly paused; EE spent 50 and
 *     EE's leftover limit rises by the $140 Groceries gave back
 *   - the budget's transaction list (derive_budget_transactions) drops the Nov 4 row; EE's has it
 *   - stored spent (recompute_budget_spent) = 30 → what rollover carries
 *   - resume restores every number exactly
 *   - Everything Else can't be paused; someone else's budget is "not found"
 * Nothing writes a split: the transactions are byte-identical before and after.
 *
 * Prereqs: firebase emulators:exec --only firestore "npx jest --selectProjects emulator --testPathPattern budgetPause"
 */

import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });
const { Timestamp } = admin.firestore;

import { create_budget_orchestrator } from "../src/functions/orchestrators/budgets/create_budget.orchestrator";
import { derive_period_orchestrator } from "../src/functions/orchestrators/periods/derive_period.orchestrator";
import { derive_budget_transactions_orchestrator } from "../src/functions/orchestrators/budgets/derive_budget_transactions.orchestrator";
import { recompute_budget_spent_orchestrator } from "../src/functions/orchestrators/budgets/recompute_budget_spent.orchestrator";
import { set_budget_pause_orchestrator } from "../src/functions/orchestrators/budgets/set_budget_pause.orchestrator";
import { assign_transaction_orchestrator } from "../src/functions/orchestrators/transactions/assign_transaction.orchestrator";
import { updateBudgetPeriodAmount } from "../src/functions/budgets/api/periods/updateBudgetPeriodAmount";
import { createEverythingElseBudget } from "../src/functions/budgets/utils/createEverythingElseBudget";
import { invalidate_category_cache } from "../src/functions/repositories/category.repo";

jest.setTimeout(120_000);

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const U = `pz_u_${RUN}`;
const OTHER = `pz_o_${RUN}`;
const id = (s: string) => `${s}_${RUN}`;
const iso_ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const t = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });
const NOV = { start: Date.UTC(2031, 10, 1), end: Date.UTC(2031, 10, 30, 23, 59, 59, 999) };
const W1 = { start: Date.UTC(2031, 10, 2), end: Date.UTC(2031, 10, 8, 23, 59, 59, 999) }; // paused
const W3 = { start: Date.UTC(2031, 10, 16), end: Date.UTC(2031, 10, 22, 23, 59, 59, 999) };

let groceries = "";
let ee = "";

async function txn(key: string, amount: number, iso: string) {
  await db.collection("transactions").doc(id(key)).set({
    transactionId: `pt_${id(key)}`, userId: U, ownerId: U, accountId: `p_${id("visa")}`,
    isActive: true, isPending: false, transactionDate: iso_ts(iso), type: "expense",
    name: key, merchantName: key, plaidDetailedCategory: "FOOD_AND_DRINK_GROCERIES",
    splits: [{
      splitId: `s_${key}`, amount, plaidPrimaryCategory: "FOOD_AND_DRINK",
      plaidDetailedCategory: "FOOD_AND_DRINK_GROCERIES", internalDetailedCategory: null,
      budgetId: "unassigned", outflowId: null, inflowId: null,
    }],
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}

async function page(view: "monthly" | "weekly", lo: number, hi: number) {
  const r = await derive_period_orchestrator(t(), U, { view_cadence: view, window_start_ms: lo, window_end_ms: hi, force: true });
  const g = r.budgets.find((b) => b.budget_id === groceries);
  const e = r.budgets.find((b) => b.budget_id === ee);
  return { g: g?.periods[0], e: e?.periods[0] };
}
const row_ids = async (budget_id: string) =>
  (await derive_budget_transactions_orchestrator(t(), U, budget_id, NOV.start, NOV.end, true))
    .map((r) => r.transaction_id).sort();
const pause = (paused: boolean, start_day = "2031-11-02", end_day = "2031-11-08", budget_id = groceries, user = U) =>
  set_budget_pause_orchestrator(t(), user, { budget_id, start_day, end_day, paused });

beforeAll(async () => {
  await db.collection("users").doc(U).set({ email: `${U}@x.com`, isActive: true, role: "editor", preferences: { currency: "USD" } });
  for (const [pid, type, s, e] of [
    ["2031M10", "monthly", "2031-10-01T00:00:00Z", "2031-10-31T23:59:59.999Z"],
    ["2031M11", "monthly", "2031-11-01T00:00:00Z", "2031-11-30T23:59:59.999Z"],
    ["2031M12", "monthly", "2031-12-01T00:00:00Z", "2031-12-31T23:59:59.999Z"],
    ["2031W45", "weekly", "2031-11-02T00:00:00Z", "2031-11-08T23:59:59.999Z"],
    ["2031W47", "weekly", "2031-11-16T00:00:00Z", "2031-11-22T23:59:59.999Z"],
  ]) {
    const ref = db.collection("source_periods").doc(pid);
    if (!(await ref.get()).exists) {
      await ref.set({ id: pid, periodId: pid, type, startDate: iso_ts(s), endDate: iso_ts(e), year: 2031 });
    }
  }
  await db.collection("categories").doc("FOOD_AND_DRINK_GROCERIES").set({
    name: "Groceries", type: "Outflow", isActive: true, overallCategoryId: "food_and_drink",
    firstCategoryId: "groceries", first_category: "Groceries", overall_category: "Food and Drink",
  });
  invalidate_category_cache();
  ee = await createEverythingElseBudget(db, U);
  groceries = (await create_budget_orchestrator(t(), U, require("crypto").randomUUID(), {
    name: "Groceries", amount: 600, category_ids: ["groceries"], period: "monthly" as never,
    budget_type: "recurring" as never, start_date: "2031-01-01T00:00:00.000Z", alert_threshold: 80,
    is_shared: false, is_ongoing: true,
  })).budget_id;
  // A stored November period (the rollover chain's input).
  await db.collection("budget_periods").doc(`${groceries}_2031M11`).set({
    id: `${groceries}_2031M11`, budgetId: groceries, userId: U, groupIds: [], periodId: "2031M11",
    sourcePeriodId: "2031M11", periodType: "monthly", isActive: true, isPrime: true,
    periodStart: iso_ts("2031-11-01T00:00:00Z"), periodEnd: iso_ts("2031-11-30T23:59:59.999Z"),
    allocatedAmount: 600, originalAmount: 600, spent: 0, remaining: 600, rolledOverAmount: 0,
    budgetName: "Groceries", createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
  await txn("paused_day", 50, "2031-11-04T12:00:00Z");
  await txn("open_day", 30, "2031-11-20T12:00:00Z");
  for (const k of ["paused_day", "open_day"]) {
    await assign_transaction_orchestrator(t(), { user_id: U, transaction_id: id(k) });
  }
});

describe("budget pause (emulator)", () => {
  let before: Awaited<ReturnType<typeof page>>;
  let splits_before: unknown;

  it("before: Groceries owns both purchases", async () => {
    before = await page("monthly", NOV.start, NOV.end);
    expect(before.g).toMatchObject({ allocated_amount: 600, spent: 80, is_paused: false, paused_days: 0 });
    splits_before = (await db.collection("transactions").doc(id("paused_day")).get()).data()!.splits;
  });

  it("pausing Nov 2–8 stores exactly that range", async () => {
    const out = await pause(true);
    expect(out.paused_ranges).toEqual([{ start: "2031-11-02", end: "2031-11-08" }]);
    const doc = (await db.collection("budgets").doc(groceries).get()).data()!;
    expect(doc.pausedRanges).toEqual([{ start: "2031-11-02", end: "2031-11-08" }]);
  });

  it("weekly page: the paused week is Paused · $0; its spending is in Everything Else", async () => {
    const w1 = await page("weekly", W1.start, W1.end);
    expect(w1.g).toMatchObject({ allocated_amount: 0, spent: 0, remaining: 0, is_paused: true, paused_days: 7 });
    expect(w1.e!.spent).toBe(50);
    const w3 = await page("weekly", W3.start, W3.end);
    expect(w3.g).toMatchObject({ allocated_amount: 140, spent: 30, is_paused: false });
  });

  it("monthly page: $460 (7 days' share out), spent 30, partly paused; EE takes $50 and its limit rises $140", async () => {
    const m = await page("monthly", NOV.start, NOV.end);
    expect(m.g).toMatchObject({ allocated_amount: 460, spent: 30, is_paused: false, paused_days: 7 });
    expect(m.e!.spent).toBe(Math.round((before.e!.spent + 50) * 100) / 100);
    expect(Math.round((m.e!.allocated_amount - before.e!.allocated_amount) * 100) / 100).toBe(140);
  });

  it("transaction lists: the Nov 4 row moved from Groceries to Everything Else", async () => {
    expect(await row_ids(groceries)).toEqual([id("open_day")]);
    expect(await row_ids(ee)).toContain(id("paused_day"));
  });

  it("a period with paused days refuses a new amount — This Period Only and All Periods Forward (Resume first)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edit = (data: unknown): Promise<any> => (updateBudgetPeriodAmount as any).run({
      data, auth: { uid: U, token: { uid: U } }, rawRequest: {},
    });
    await expect(edit({ budgetPeriodId: `${groceries}_2031M11`, newAmount: 500, cascadeScope: "this_period" }))
      .rejects.toThrow(/Resume this period/);
    await expect(edit({ budgetPeriodId: `${groceries}_2031M11`, newAmount: 500, cascadeScope: "all_forward" }))
      .rejects.toThrow(/Resume this period/);
  });

  it("stored spent (what rollover carries) leaves the paused day out", async () => {
    await recompute_budget_spent_orchestrator(t(), {
      user_id: U, budget_ids: [groceries], dates_ms_by_budget: { [groceries]: [Date.UTC(2031, 10, 4, 12)] },
    });
    const p = (await db.collection("budget_periods").doc(`${groceries}_2031M11`).get()).data()!;
    expect(p.spent).toBe(30);
  });

  it("the pause queues a spent recompute that also re-runs the rollover chain (verify #1 M1)", async () => {
    const jobs = async (type: string) => (await db.collection("_jobs").where("job_type", "==", type).get()).docs
      .map((d) => d.data().payload as Record<string, unknown>);
    // The pause's own job: one date per paused day (Nov 2–8 → 7).
    const recompute = (await jobs("recompute_budget_spent")).filter((p) =>
      ((p.dates_ms_by_budget as Record<string, number[]> | undefined)?.[groceries] ?? []).length === 7);
    expect(recompute.length).toBeGreaterThan(0);
    expect(recompute[0]).toMatchObject({ force_rollover: true, user_id: U });
    // Groceries has no explicit rolloverEnabled (rollover is on by default): the chain still runs.
    const rollover_jobs = async () => (await jobs("recalculate_rollover")).filter((p) => p.budget_id === groceries).length;
    const before_n = await rollover_jobs();
    await recompute_budget_spent_orchestrator(t(), recompute[0] as never);
    expect(await rollover_jobs()).toBeGreaterThan(before_n);
  });

  it("no split was rewritten", async () => {
    expect((await db.collection("transactions").doc(id("paused_day")).get()).data()!.splits).toEqual(splits_before);
  });

  it("resume restores every number", async () => {
    const out = await pause(false);
    expect(out.paused_ranges).toEqual([]);
    expect((await db.collection("budgets").doc(groceries).get()).data()!.pausedRanges).toBeUndefined();
    const m = await page("monthly", NOV.start, NOV.end);
    expect(m.g).toMatchObject({ allocated_amount: 600, spent: 80, is_paused: false, paused_days: 0 });
    expect(m.e!.spent).toBe(before.e!.spent);
    expect(m.e!.allocated_amount).toBe(before.e!.allocated_amount);
    await recompute_budget_spent_orchestrator(t(), {
      user_id: U, budget_ids: [groceries], dates_ms_by_budget: { [groceries]: [Date.UTC(2031, 10, 4, 12)] },
    });
    expect((await db.collection("budget_periods").doc(`${groceries}_2031M11`).get()).data()!.spent).toBe(80);
  });

  it("Everything Else can't be paused; another user's budget is not found", async () => {
    await expect(pause(true, "2031-11-02", "2031-11-08", ee)).rejects.toThrow(/Everything Else/);
    await expect(pause(true, "2031-11-02", "2031-11-08", groceries, OTHER)).rejects.toThrow(/not found/i);
  });
});
