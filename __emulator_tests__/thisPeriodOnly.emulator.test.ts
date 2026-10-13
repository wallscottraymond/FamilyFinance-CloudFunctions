/**
 * Emulator Integration Test — "This Period Only" / "Reset" / "All Periods Forward" as the PERIOD
 * PAGE shows them (Transaction-Integrity X10, app action U9 / decision 4c-9).
 *
 * The page (derive_period) builds every view's budget allocation from the budget's MONTHLY
 * budget_periods only. Every assertion here reads the page, for every budget cadence
 * {monthly, weekly, bi_monthly, quarterly} × every edited view {month, week, week straddling two
 * months, bi-monthly half}: the edited bucket shows EXACTLY what was typed, buckets that don't
 * overlap it are unchanged, re-editing sets (never accumulates), Reset restores, and All Periods
 * Forward makes the edited bucket show what was typed. Budget periods come from the real generator
 * (process_budget_created).
 *
 * Prereqs: firebase emulators:exec --only firestore "npx jest --selectProjects emulator --testPathPattern thisPeriodOnly"
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();

import { derive_period_orchestrator } from "../src/functions/orchestrators/periods/derive_period.orchestrator";
import { process_budget_created_orchestrator } from "../src/functions/orchestrators/budgets/process_budget_created.orchestrator";
import { process_budget_updated_orchestrator } from "../src/functions/orchestrators/budgets/process_budget_updated.orchestrator";
import { budget_cadence_to_instance } from "../src/functions/domain/budgets/period_generation.service";
import { page_share } from "../src/functions/domain/budgets/period_share.service";
import { updateBudgetPeriodAmount } from "../src/functions/budgets/api/periods/updateBudgetPeriodAmount";
import { BudgetPeriodType } from "../src/functions/types/budgets/budget_entity.types";

jest.setTimeout(240_000);

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const U = `tp_u_${RUN}`;
const DAY = 86_400_000;
const ts = (ms: number) => Timestamp.fromMillis(ms);
const t = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const end_of = (day_ms: number) => day_ms + DAY - 1;
const cents = (n: number) => Math.round(n * 100);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edit = (data: unknown): Promise<any> => (updateBudgetPeriodAmount as any).run({
  data, auth: { uid: U, token: { uid: U } }, rawRequest: {},
});

/* eslint-disable @typescript-eslint/naming-convention */

// ---- source periods (same shapes / ids as admin/generateSourcePeriods) ------------------------

// Calendar periods this file CREATED (not ones another suite / a previous run left) — removed in
// afterAll so the shared, global `source_periods` collection looks as it did (other suites, e.g.
// extendBudgetPeriodsV2, generate from whatever calendar periods exist).
const created_source_periods = new Set<string>();

async function seed_source_periods(year: number, from_month: number, to_month: number) {
  const writes: Array<Promise<unknown>> = [];
  const put = (id: string, type: string, s: number, e: number) =>
    writes.push((async () => {
      const ref = db.collection("source_periods").doc(id);
      if (!(await ref.get()).exists) created_source_periods.add(id);
      await ref.set({ id, periodId: id, type, startDate: ts(s), endDate: ts(e), year });
    })());
  for (let m = from_month; m <= to_month; m++) {
    const mm = String(m).padStart(2, "0");
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    put(`${year}M${mm}`, "monthly", utc(year, m, 1), end_of(utc(year, m, last)));
    put(`${year}BM${mm}A`, "bi_monthly", utc(year, m, 1), end_of(utc(year, m, 15)));
    put(`${year}BM${mm}B`, "bi_monthly", utc(year, m, 16), end_of(utc(year, m, last)));
  }
  // Sunday-start weeks numbered from the week containing Jan 1 — only weeks inside the year.
  let s = utc(year, 1, 1);
  while (new Date(s).getUTCDay() !== 0) s -= DAY;
  const lo = utc(year, from_month, 1) - 7 * DAY;
  const hi = utc(year, to_month + 1, 1);
  for (let n = 1; new Date(s + 6 * DAY).getUTCFullYear() === year; n++, s += 7 * DAY) {
    if (s >= lo && s < hi) put(`${year}W${String(n).padStart(2, "0")}`, "weekly", s, end_of(s + 6 * DAY));
  }
  await Promise.all(writes);
}

// ---- budgets via the real generator ------------------------------------------------------------

async function create_budget(
  id: string, period: BudgetPeriodType, amount: number, start_ms: number, gen_end_ms: number
): Promise<void> {
  await db.collection("budgets").doc(id).set({
    id, userId: U, createdBy: U, groupIds: [], isActive: true,
    access: { ownerId: U, createdBy: U, groupIds: [], isPrivate: true },
    name: id, amount, currency: "USD", categoryIds: [`cat_${id}`], period,
    budgetType: "recurring", startDate: ts(start_ms), isOngoing: true,
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
  await process_budget_created_orchestrator(t(), {
    budget_id: id, user_id: U, group_ids: [], budget_name: id, category_ids: [],
    amount, cadence: budget_cadence_to_instance(period), start_ms, generation_end_ms: gen_end_ms,
    is_recurring: true, claims: [], everything_else_budget_id: null,
  });
}

// ---- the PAGE ----------------------------------------------------------------------------------

type View = "monthly" | "weekly" | "bi_monthly";
const VIEWS: View[] = ["monthly", "weekly", "bi_monthly"];
interface Bucket { amount: number; start_ms: number; end_ms: number }
type Page = Record<View, Map<string, Bucket>>;

async function page(budget_id: string, lo: number, hi: number): Promise<Page> {
  const out = {} as Page;
  for (const view of VIEWS) {
    const r = await derive_period_orchestrator(t(), U, {
      view_cadence: view, window_start_ms: lo, window_end_ms: hi, force: true,
    });
    const b = r.budgets.find((x) => x.budget_id === budget_id);
    out[view] = new Map((b?.periods ?? []).map((p) => [
      p.period_id, { amount: p.allocated_amount, start_ms: p.start_ms, end_ms: p.end_ms },
    ]));
  }
  return out;
}

const day_idx = (ms: number) => Math.floor(ms / DAY);
const overlaps = (a: { start_ms: number; end_ms: number }, b: { start_ms: number; end_ms: number }) =>
  day_idx(a.start_ms) <= day_idx(b.end_ms) && day_idx(b.start_ms) <= day_idx(a.end_ms);

/** Every bucket of every view that does NOT overlap `edited` is unchanged (to the cent). */
function expect_untouched_outside(before: Page, after: Page, edited: { start_ms: number; end_ms: number }) {
  for (const view of VIEWS) {
    for (const [pid, b] of before[view]) {
      if (overlaps(b, edited)) continue;
      expect([view, pid, cents(after[view].get(pid)!.amount)]).toEqual([view, pid, cents(b.amount)]);
    }
  }
}
function expect_same(before: Page, after: Page) {
  for (const view of VIEWS) {
    for (const [pid, b] of before[view]) {
      expect([view, pid, cents(after[view].get(pid)!.amount)]).toEqual([view, pid, cents(b.amount)]);
    }
  }
}
const sum = (m: Map<string, Bucket>) => [...m.values()].reduce((s, b) => s + b.amount, 0);

// ---- the matrix --------------------------------------------------------------------------------

const Y = 2031;
const START = utc(Y, 8, 1);
const GEN_END = end_of(utc(Y, 12, 27));
const WIN = { lo: utc(Y, 9, 1), hi: end_of(utc(Y, 11, 30)) };

const CADENCES: Array<{ period: BudgetPeriodType; amount: number }> = [
  { period: "monthly", amount: 400 },
  { period: "weekly", amount: 100 },
  { period: "bi_monthly", amount: 200 },
  { period: "quarterly", amount: 900 },
];
const EDITS: Array<{ label: string; view: View; pid: string; start_ms: number; end_ms: number }> = [
  { label: "a month", view: "monthly", pid: `${Y}M10`, start_ms: utc(Y, 10, 1), end_ms: end_of(utc(Y, 10, 31)) },
  { label: "a week", view: "weekly", pid: `${Y}W41`, start_ms: utc(Y, 10, 5), end_ms: end_of(utc(Y, 10, 11)) },
  { label: "a week straddling Sep/Oct", view: "weekly", pid: `${Y}W40`, start_ms: utc(Y, 9, 28), end_ms: end_of(utc(Y, 10, 4)) },
  { label: "a bi-monthly half", view: "bi_monthly", pid: `${Y}BM10B`, start_ms: utc(Y, 10, 16), end_ms: end_of(utc(Y, 10, 31)) },
];

describe("This Period Only / Reset / All Periods Forward on the period page (emulator)", () => {
  beforeAll(async () => {
    await seed_source_periods(Y, 7, 12);
    await db.collection("users").doc(U).set({ email: "x@x.com", isActive: true, role: "editor" });
  });
  afterAll(async () => {
    await Promise.all(
      [...created_source_periods].map((id) => db.collection("source_periods").doc(id).delete())
    );
    await db.terminate();
  });

  for (const c of CADENCES) {
    for (const e of EDITS) {
      it(`${c.period} budget — This Period Only on ${e.label}: page shows exactly what was typed`, async () => {
        const B = `tp_${c.period}_${e.pid}_${RUN}`;
        await create_budget(B, c.period, c.amount, START, GEN_END);
        const before = await page(B, WIN.lo, WIN.hi);
        const was = before[e.view].get(e.pid)!.amount;
        expect(was).toBeGreaterThan(0);

        // Edit → the page shows exactly 123.45 for the edited bucket; nothing else moves.
        await edit({ budgetPeriodId: `${B}_${e.pid}`, newAmount: 123.45, cascadeScope: "this_period" });
        const after = await page(B, WIN.lo, WIN.hi);
        expect(cents(after[e.view].get(e.pid)!.amount)).toBe(12345);
        expect_untouched_outside(before, after, e);
        expect((await db.collection("budget_periods").doc(`${B}_${e.pid}`).get()).data()!.hasPeriodAdjustment)
          .toBe(true);

        // Re-edit the same bucket → SETS (never accumulates).
        await edit({ budgetPeriodId: `${B}_${e.pid}`, newAmount: 61.07, cascadeScope: "this_period" });
        const again = await page(B, WIN.lo, WIN.hi);
        expect(cents(again[e.view].get(e.pid)!.amount)).toBe(6107);
        expect_untouched_outside(before, again, e);
        expect(sum(again.monthly) - sum(before.monthly)).toBeCloseTo(61.07 - was, 1);

        // Reset → the page is back to exactly what it was.
        await edit({ budgetPeriodId: `${B}_${e.pid}`, reset: true });
        expect_same(before, await page(B, WIN.lo, WIN.hi));
        expect((await db.collection("budget_periods").doc(`${B}_${e.pid}`).get()).data()!.hasPeriodAdjustment)
          .toBe(false);
      });

      it(`${c.period} budget — All Periods Forward on ${e.label}: page shows what was typed`, async () => {
        const B = `afp_${c.period}_${e.pid}_${RUN}`;
        await create_budget(B, c.period, c.amount, START, GEN_END);
        // One-offs on the edited period and on a later one are both cleared by All Periods Forward.
        await edit({ budgetPeriodId: `${B}_${e.pid}`, newAmount: 77.77, cascadeScope: "this_period" });
        await edit({ budgetPeriodId: `${B}_${Y}W46`, newAmount: 5, cascadeScope: "this_period" });

        await edit({ budgetPeriodId: `${B}_${e.pid}`, newAmount: 250, cascadeScope: "all_forward" });
        const share = page_share(e.start_ms, e.end_ms, c.period);
        const budget = (await db.collection("budgets").doc(B).get()).data()!;
        expect(budget.amount).toBe(Math.round((250 / share) * 100) / 100);
        const after = await page(B, WIN.lo, WIN.hi);
        // The budget amount is stored in cents, so the edited bucket is typed ± ½¢ × its share
        // (+ the stored monthly home's own cent rounding).
        expect(Math.abs(after[e.view].get(e.pid)!.amount - 250)).toBeLessThanOrEqual(0.005 * share + 0.011);
        // No one-off survives from the edited period on.
        const periods = await db.collection("budget_periods").where("budgetId", "==", B).get();
        for (const d of periods.docs) {
          if (d.data().periodEnd.toMillis() < e.start_ms) continue;
          expect([d.id, d.data().periodAdjustments ?? []]).toEqual([d.id, []]);
          expect([d.id, d.data().hasPeriodAdjustment ?? false]).toEqual([d.id, false]);
        }
      });
    }
  }

  // Custom periods stay ABSOLUTE across re-allocation (adjustments are rebased, not left as
  // stale deltas): All Periods Forward on a LATER month, then an update_budget amount change.
  for (const c of CADENCES) {
    it(`${c.period} budget — a custom November week keeps its amount through later re-allocations`, async () => {
      const B = `tp_rebase_${c.period}_${RUN}`;
      await create_budget(B, c.period, c.amount, START, GEN_END);
      const NOV_WEEK = `${Y}W46`; // Nov 9–15, inside November
      const STRADDLE = `${Y}W44`; // Oct 26 – Nov 1, across two months
      await edit({ budgetPeriodId: `${B}_${NOV_WEEK}`, newAmount: 5, cascadeScope: "this_period" });
      await edit({ budgetPeriodId: `${B}_${STRADDLE}`, newAmount: 42.42, cascadeScope: "this_period" });
      const week = async (pid: string) => (await page(B, WIN.lo, WIN.hi)).weekly.get(pid)!.amount;
      expect(cents(await week(NOV_WEEK))).toBe(500);

      // All Periods Forward on December: November (re-allocated, before the edited month) keeps
      // its custom weeks — rebased, not cleared.
      await edit({ budgetPeriodId: `${B}_${Y}M12`, newAmount: 777, cascadeScope: "all_forward" });
      expect(cents(await week(NOV_WEEK))).toBe(500);
      expect(Math.abs((await week(STRADDLE)) - 42.42)).toBeLessThanOrEqual(0.01);
      // (A weekly budget's December home is short here — its weeks are generated only through
      // Dec 27 to stay clear of the year-boundary week — so December is checked for the others.)
      if (c.period !== "weekly") {
        const dec = (await page(B, WIN.lo, end_of(utc(Y, 12, 31)))).monthly.get(`${Y}M12`)!.amount;
        expect(Math.abs(dec - 777)).toBeLessThanOrEqual(0.005 * page_share(utc(Y, 12, 1),
          end_of(utc(Y, 12, 31)), c.period) + 0.011);
      }

      // update_budget amount change → process_budget_updated re-allocates (cutoff today).
      const amount = Math.round(c.amount * 1.37 * 100) / 100;
      await db.collection("budgets").doc(B).update({ amount });
      await process_budget_updated_orchestrator(t(), {
        budget_id: B, user_id: U, group_ids: [], budget_name: B, category_ids: [],
        amount, cadence: budget_cadence_to_instance(c.period), start_ms: START,
        generation_end_ms: GEN_END, is_recurring: true, added_claims: [],
        released_category_ids: [], everything_else_budget_id: null, range_changed: false,
        regenerate_periods: true, name_changed: false,
      });
      expect(cents(await week(NOV_WEEK))).toBe(500);
      expect(Math.abs((await week(STRADDLE)) - 42.42)).toBeLessThanOrEqual(0.01);
      // …and the stored remaining agrees with THE amount rule on the November doc.
      const nov = (await db.collection("budget_periods").doc(`${B}_${Y}M11`).get()).data()!;
      const adj = (nov.periodAdjustments as Array<{ amount: number }>).reduce((x, a) => x + a.amount, 0);
      expect(nov.remaining).toBeCloseTo(nov.allocatedAmount + adj + (nov.rolledOverAmount ?? 0)
        - (nov.spent ?? 0), 2);
    });
  }

  it("All Periods Forward clears the custom periods from the edited month on (forward = reset)", async () => {
    const B = `tp_afpclear_${RUN}`;
    await create_budget(B, "monthly", 400, START, GEN_END);
    await edit({ budgetPeriodId: `${B}_${Y}W41`, newAmount: 9, cascadeScope: "this_period" }); // Oct 5–11
    await edit({ budgetPeriodId: `${B}_${Y}W44`, newAmount: 9, cascadeScope: "this_period" }); // Oct 26–Nov 1
    await edit({ budgetPeriodId: `${B}_${Y}W38`, newAmount: 9, cascadeScope: "this_period" }); // Sep 14–20
    // All Periods Forward from a LATER October week clears every October custom period (and both
    // parts of the straddling one) but keeps — rebased — September's.
    await edit({ budgetPeriodId: `${B}_${Y}W43`, newAmount: 70, cascadeScope: "all_forward" });
    const p = await page(B, WIN.lo, WIN.hi);
    expect(cents(p.weekly.get(`${Y}W38`)!.amount)).toBe(900);
    const budget = (await db.collection("budgets").doc(B).get()).data()!;
    expect(cents(p.weekly.get(`${Y}W41`)!.amount)).toBe(cents(budget.amount * 7 / 31));
    for (const m of ["M10", "M11"]) {
      const d = (await db.collection("budget_periods").doc(`${B}_${Y}${m}`).get()).data()!;
      expect([m, d.periodAdjustments ?? []]).toEqual([m, []]);
    }
    const sep = (await db.collection("budget_periods").doc(`${B}_${Y}M09`).get()).data()!;
    expect((sep.periodAdjustments as Array<{ periodId: string }>).map((a) => a.periodId))
      .toEqual([`${Y}W38`]);
  });

  it("a straddling week needs BOTH months' monthly docs (failed-precondition otherwise)", async () => {
    const B = `tp_missing_${RUN}`;
    await create_budget(B, "monthly", 400, START, GEN_END);
    await db.collection("budget_periods").doc(`${B}_${Y}M11`).delete();
    await expect(edit({ budgetPeriodId: `${B}_${Y}W44`, newAmount: 10, cascadeScope: "this_period" }))
      .rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("a past period can't be edited", async () => {
    const B = `tp_past_${RUN}`;
    await create_budget(B, "monthly", 400, START, GEN_END);
    await db.collection("budget_periods").doc(`${B}_2020M01`).set({
      id: `${B}_2020M01`, budgetId: B, userId: U, periodId: "2020M01", periodType: "monthly",
      periodStart: ts(utc(2020, 1, 1)), periodEnd: ts(end_of(utc(2020, 1, 31))),
      allocatedAmount: 400, isActive: true,
    });
    await expect(edit({ budgetPeriodId: `${B}_2020M01`, newAmount: 10, cascadeScope: "this_period" }))
      .rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("All Periods Forward on the CURRENT month of a weekly budget re-allocates its earlier weeks too", async () => {
    // Real "today": weeks of this month that already ended must take the new rate, or the
    // month (spread evenly by the page) can't show what was typed.
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth() + 1;
    if (m === 1 || m === 12) return; // year-boundary weeks are duplicated by design; skip
    // Only this month's source periods (they're global — keep other suites' windows clean).
    await seed_source_periods(y, m, m);
    const B = `afp_now_${RUN}`;
    await create_budget(B, "weekly", 100, utc(y, m, 1), end_of(utc(y, m + 1, 1) - DAY));
    const pid = `${y}M${String(m).padStart(2, "0")}`;
    const ms = { start_ms: utc(y, m, 1), end_ms: end_of(utc(y, m + 1, 1) - DAY) };
    await edit({ budgetPeriodId: `${B}_${pid}`, newAmount: 500, cascadeScope: "all_forward" });
    const share = page_share(ms.start_ms, ms.end_ms, "weekly");
    const r = await derive_period_orchestrator(t(), U, {
      view_cadence: "monthly", window_start_ms: ms.start_ms, window_end_ms: ms.end_ms, force: true,
    });
    const got = r.budgets.find((x) => x.budget_id === B)!.periods.find((p) => p.period_id === pid)!;
    expect(Math.abs(got.allocated_amount - 500)).toBeLessThanOrEqual(0.005 * share + 0.011);
  });

  it("All Periods Forward on the CURRENT week of a weekly budget: the week shows what was typed", async () => {
    // This month's earlier weeks already ended; the page spreads the month evenly, so they must
    // take the new rate too.
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth() + 1;
    if (m === 1 || m === 12) return;
    await seed_source_periods(y, m, m);
    const B = `afp_now_wk_${RUN}`;
    await create_budget(B, "weekly", 100, utc(y, m, 1), end_of(utc(y, m + 1, 1) - DAY));
    const today = Date.UTC(y, m - 1, now.getUTCDate());
    const wk = (await db.collection("budget_periods").where("budgetId", "==", B).get()).docs
      .map((d) => d.data())
      .find((d) => d.periodType === "weekly" &&
        d.periodStart.toMillis() <= today && d.periodEnd.toMillis() >= today)!;
    await edit({ budgetPeriodId: wk.id, newAmount: 150, cascadeScope: "all_forward" });
    expect((await db.collection("budgets").doc(B).get()).data()!.amount).toBe(150);
    const r = await derive_period_orchestrator(t(), U, {
      view_cadence: "weekly", window_start_ms: wk.periodStart.toMillis(),
      window_end_ms: wk.periodEnd.toMillis(), force: true,
    });
    const got = r.budgets.find((x) => x.budget_id === B)!.periods.find((p) => p.period_id === wk.periodId)!;
    expect(Math.abs(got.allocated_amount - 150)).toBeLessThanOrEqual(0.011);
  });

  // ---- legacy `modifiedAmount` (pre-adjustment data) stays readable --------------------------

  describe("legacy modifiedAmount on a monthly doc", () => {
    const B = `tp_legacy_${RUN}`;
    const P = `${B}_${Y}M07`;
    const JUL = { lo: utc(Y, 7, 1), hi: end_of(utc(Y, 7, 31)) };
    const july = async () => (await page(B, JUL.lo, JUL.hi)).monthly.get(`${Y}M07`)!.amount;
    beforeAll(async () => {
      await db.collection("budgets").doc(B).set({
        id: B, userId: U, createdBy: U, groupIds: [], isActive: true,
        access: { ownerId: U, createdBy: U, groupIds: [], isPrivate: true },
        name: "Dining", amount: 400, currency: "USD", categoryIds: ["eating_out"], period: "monthly",
        budgetType: "recurring", startDate: ts(utc(Y, 1, 1)), isOngoing: true,
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
      await db.collection("budget_periods").doc(P).set({
        id: P, budgetId: B, userId: U, groupIds: [], periodId: `${Y}M07`, sourcePeriodId: `${Y}M07`,
        periodType: "monthly", periodStart: ts(JUL.lo), periodEnd: ts(JUL.hi),
        allocatedAmount: 400, rolledOverAmount: 0, spent: 0, remaining: 400, isActive: true,
      });
    });

    it("a direct override shows; isModified false or a synced copy doesn't", async () => {
      expect(await july()).toBe(400);
      await db.collection("budget_periods").doc(P).update({ modifiedAmount: 250, isModified: true });
      expect(await july()).toBe(250);
      await db.collection("budget_periods").doc(P).update({ isModified: false });
      expect(await july()).toBe(400);
      await db.collection("budget_periods").doc(P).update({
        modifiedAmount: 150, isModified: true, modifiedAmountSyncedFrom: `${B}_${Y}W30`,
      });
      expect(await july()).toBe(400);
    });

    it("a week's This Period Only on top of a legacy month override: week = typed, month = override + Δ", async () => {
      await db.collection("budget_periods").doc(P).update({
        modifiedAmount: 310, isModified: true, modifiedAmountSyncedFrom: admin.firestore.FieldValue.delete(),
      });
      const W = `${B}_${Y}W28`; // Jul 6–12
      await db.collection("budget_periods").doc(W).set({
        id: W, budgetId: B, userId: U, groupIds: [], periodId: `${Y}W28`, sourcePeriodId: `${Y}W28`,
        periodType: "weekly", periodStart: ts(utc(Y, 7, 6)), periodEnd: ts(end_of(utc(Y, 7, 12))),
        allocatedAmount: 90.32, spent: 0, isActive: true, isPrime: false,
      });
      await edit({ budgetPeriodId: W, newAmount: 100, cascadeScope: "this_period" });
      const p = await page(B, JUL.lo, JUL.hi);
      expect(p.weekly.get(`${Y}W28`)!.amount).toBe(100); // 310 × 7/31 = 70 → +30
      expect(p.monthly.get(`${Y}M07`)!.amount).toBe(340);
      // The legacy override is untouched (no sync-copy machinery for new edits).
      const month = (await db.collection("budget_periods").doc(P).get()).data()!;
      expect(month.modifiedAmount).toBe(310);
      expect(month.periodAdjustments).toEqual([
        { periodId: `${Y}W28`, startMs: utc(Y, 7, 6), endMs: end_of(utc(Y, 7, 12)), amount: 30 },
      ]);
      expect(month.remaining).toBe(340);
    });
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
