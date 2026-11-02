/**
 * Emulator Integration Tests — Account-Rooted-Sharing Phase 2.2 (budgets belong to a view, PD6)
 *
 * Group Everything Else provisioning, create in a group, move Me → group (budget +
 * periods re-keyed), member vs stranger edits, copy with a conflict, and a
 * leaver's moved-in budget going back to them.
 *
 * Prereq: firebase emulators:exec --only firestore \
 *   "npx jest --selectProjects emulator --testPathPattern sharingBudgets"
 */

import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "family-budget-app-cb59b" });
}
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

import {
  get_my_connect_code_orchestrator,
  enter_connect_code_orchestrator,
} from "../src/functions/orchestrators/sharing/connect.orchestrator";
import { get_sharing_overview_orchestrator } from "../src/functions/orchestrators/sharing/connections.orchestrator";
import {
  create_group_orchestrator,
  respond_to_request_orchestrator,
  manage_group_orchestrator,
} from "../src/functions/orchestrators/sharing/groups.orchestrator";
import {
  move_budget_orchestrator,
  copy_budgets_to_group_orchestrator,
} from "../src/functions/orchestrators/sharing/budget_view.orchestrator";
import { create_budget_orchestrator } from "../src/functions/orchestrators/budgets/create_budget.orchestrator";
import { resolve_update_budget_dependencies } from "../src/functions/resolvers/budgets/update_budget.resolver";
import { NotFoundError } from "../src/functions/types";
import { derive_period_orchestrator } from "../src/functions/orchestrators/periods/derive_period.orchestrator";
import { update_budget_orchestrator } from "../src/functions/orchestrators/budgets/update_budget.orchestrator";
import { set_budget_pause_orchestrator } from "../src/functions/orchestrators/budgets/set_budget_pause.orchestrator";

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const ALEX = `alex_${RUN}`;
const SAM = `sam_${RUN}`;
const MALLORY = `mallory_${RUN}`;

function ctx<T>(user_id: string, input: T) {
  return {
    trace_id: `t_${Math.random()}`, span_id: `s_${Math.random()}`,
    user_id, input, idempotency_key: `k_${Math.random()}`,
  };
}
const t = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });
const uuid = () => require("crypto").randomUUID() as string;
const budget = async (id: string) => (await db.collection("budgets").doc(id).get()).data()!;

async function create(user_id: string, name: string, cats: string[], view_group_id?: string) {
  const res = await create_budget_orchestrator(t(), user_id, uuid(), {
    name, amount: 400, category_ids: cats, period: "monthly" as never, budget_type: "recurring" as never,
    start_date: "2026-10-01T00:00:00.000Z", alert_threshold: 80, is_shared: false,
    is_ongoing: true, view_group_id,
  });
  return res.budget_id;
}

jest.setTimeout(120_000);

let group_id = "";
let KEY = "";

beforeAll(async () => {
  for (const u of [ALEX, SAM, MALLORY]) {
    await db.collection("users").doc(u).set({ email: `${u}@x.com`, preferences: { currency: "USD" } });
  }
  const a = (await get_my_connect_code_orchestrator(ctx(ALEX, { refresh: true }))).code;
  const s = (await get_my_connect_code_orchestrator(ctx(SAM, { refresh: true }))).code;
  await enter_connect_code_orchestrator(ctx(ALEX, { code: s }));
  await enter_connect_code_orchestrator(ctx(SAM, { code: a }));
  group_id = (await create_group_orchestrator(ctx(ALEX, { name: "The Walls", invitee_ids: [SAM] })))
    .group_id!;
  KEY = `group:${group_id}`;
  const r = (await get_sharing_overview_orchestrator(ctx(SAM, {} as Record<string, never>))).requests[0];
  await respond_to_request_orchestrator(ctx(SAM, { request_id: r.id, accept: true }));
});

describe("budgets belong to a view (emulator)", () => {
  let groceries = "";

  it("D6 a new group gets its own Everything Else budgets", async () => {
    const ee = await db.collection("budgets").where("userId", "==", KEY)
      .where("isSystemEverythingElse", "==", true).get();
    expect(ee.size).toBe(3);
  });

  it("create in a group: owner key = group, createdBy = the person; non-member refused", async () => {
    const id = await create(SAM, "Gas", ["TRANSPORTATION_GAS"], group_id);
    const doc = await budget(id);
    expect(doc.userId).toBe(KEY);
    expect(doc.createdBy).toBe(SAM);
    await expect(create(MALLORY, "Nope", ["X"], group_id)).rejects.toBeTruthy();
  });

  it("T-DF-03 move Me → group: budget + periods re-keyed, broughtBy = mover", async () => {
    groceries = await create(ALEX, "Groceries", ["FOOD_AND_DRINK_GROCERIES"]);
    for (const p of ["2026M10", "2026M11"]) {
      // Complete + inactive so suites that scan every period (daily rollover) skip it.
      const start = admin.firestore.Timestamp.fromDate(new Date("2020-01-01T00:00:00Z"));
      await db.collection("budget_periods").doc(`${groceries}_${p}`).set({
        budgetId: groceries, userId: ALEX, ownerId: ALEX, periodId: p, periodType: "monthly",
        periodStart: start, periodEnd: start, allocatedAmount: 400, spent: 0, remaining: 400,
        isActive: false,
      });
    }
    const res = await move_budget_orchestrator(ctx(ALEX, { budget_id: groceries, to_group_id: group_id }));
    expect(res.success).toBe(true);
    const doc = await budget(groceries);
    expect(doc.userId).toBe(KEY);
    expect(doc.broughtBy).toBe(ALEX);
    expect(doc.createdBy).toBe(ALEX);
    const periods = await db.collection("budget_periods").where("budgetId", "==", groceries).get();
    expect(periods.docs.map((d) => d.data().userId)).toEqual([KEY, KEY]);
  });

  it("any member can edit a group budget; a stranger can't", async () => {
    await expect(resolve_update_budget_dependencies(t(), SAM, { budget_id: groceries, amount: 500 } as never))
      .resolves.toBeDefined();
    await expect(resolve_update_budget_dependencies(t(), MALLORY, { budget_id: groceries, amount: 1 } as never))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it("T-DF-13/15 copy: new group budget; a clash comes back as a conflict", async () => {
    const dining = await create(ALEX, "Dining Out", ["FOOD_AND_DRINK_RESTAURANT"]);
    const again = await create(ALEX, "Groceries", ["FOOD_AND_DRINK_GROCERIES"]); // Me copy again
    const res = await copy_budgets_to_group_orchestrator(ctx(ALEX, {
      group_id, remove_from_me: false,
      items: [{ budget_id: dining, amount: 350 }, { budget_id: again, amount: 400 }],
    }));
    expect(res.success).toBe(true);
    expect(res.budget_ids).toHaveLength(1);
    const copy = await budget(res.budget_ids![0]);
    expect(copy).toMatchObject({ userId: KEY, name: "Dining Out", amount: 350, createdBy: ALEX });
    expect((await budget(dining)).userId).toBe(ALEX); // original stays private
    expect(res.conflicts?.[0]).toMatchObject({ existing_budget_id: groceries, existing_name: "Groceries" });
  });

  // S1-M4 (user decision 2026-11-02): while Sam's budgets sit in the group, he makes new Me
  // budgets for some of their categories. Leaving: his Me budgets KEEP those categories; the
  // returning ones come back without them — and paused when nothing is left. Nothing deleted.
  let fast_food = "";
  let me_fast = "";
  let me_bar = "";
  let sams = "";
  let left: Awaited<ReturnType<typeof manage_group_orchestrator>> | null = null;

  it("S1-M4 setup: Sam moves two budgets in, then budgets some of their categories in Me", async () => {
    sams = await create(SAM, "Coffee", ["FOOD_AND_DRINK_COFFEE", "FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR"]);
    fast_food = await create(SAM, "Fast Food", ["FOOD_AND_DRINK_FAST_FOOD"]);
    for (const id of [sams, fast_food]) {
      expect((await move_budget_orchestrator(ctx(SAM, { budget_id: id, to_group_id: group_id }))).success)
        .toBe(true);
    }
    me_bar = await create(SAM, "Bar", ["FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR"]);
    me_fast = await create(SAM, "Quick Bites", ["FOOD_AND_DRINK_FAST_FOOD"]);
  });

  it("T-LV-04a a leaver's moved-in budget goes back to them; group-made budgets stay", async () => {
    left = await manage_group_orchestrator(ctx(SAM, { group_id, action: "leave" }));
    expect(left.success).toBe(true);
    const back = await budget(sams);
    expect(back.userId).toBe(SAM);
    expect(back.broughtBy ?? null).toBeNull();
    expect((await budget(groceries)).userId).toBe(KEY); // Alex's moved-in budget stays (Alex didn't leave)
  });

  it("S1-M4 leaving: the Me budgets keep their categories; the returning ones give them up", async () => {
    // Me budgets untouched.
    expect((await budget(me_bar)).categoryIds).toEqual(["FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR"]);
    expect((await budget(me_fast)).categoryIds).toEqual(["FOOD_AND_DRINK_FAST_FOOD"]);
    // Coffee keeps its other category, not paused.
    const coffee = await budget(sams);
    expect(coffee.userId).toBe(SAM);
    expect(coffee.categoryIds).toEqual(["FOOD_AND_DRINK_COFFEE"]);
    expect(coffee.pausedRanges ?? []).toEqual([]);
    // Fast Food has nothing left → back in Me, kept (not deleted), PAUSED from today on.
    const ff = await budget(fast_food);
    expect(ff.userId).toBe(SAM);
    expect(ff.isActive).not.toBe(false);
    expect(ff.categoryIds).toEqual([]);
    const today = new Date().toISOString().slice(0, 10);
    expect(ff.pausedRanges).toEqual([{ start: today, end: "2099-12-31" }]);
    // The leaver is told what changed.
    const changes = (left as { returned_budgets?: unknown[] } | null)?.returned_budgets;
    expect(changes).toEqual(expect.arrayContaining([
      { budget_id: sams, name: "Coffee", removed_category_ids: ["FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR"], paused: false },
      { budget_id: fast_food, name: "Fast Food", removed_category_ids: ["FOOD_AND_DRINK_FAST_FOOD"], paused: true },
    ]));
    expect(changes).toHaveLength(2); // an unchanged return isn't news
  });

  it("S1-M4 derive: next month the emptied budget shows Paused and allocates nothing", async () => {
    const now = new Date();
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1) - 1;
    const d = new Date(start);
    const pid = `${d.getUTCFullYear()}M${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const ref = db.collection("source_periods").doc(pid);
    if (!(await ref.get()).exists) {
      await ref.set({
        id: pid, periodId: pid, type: "monthly", startDate: admin.firestore.Timestamp.fromMillis(start),
        endDate: admin.firestore.Timestamp.fromMillis(end), year: d.getUTCFullYear(),
      });
    }
    const r = await derive_period_orchestrator(t(), SAM, {
      view_cadence: "monthly", window_start_ms: start, window_end_ms: end, force: true,
    });
    const ff = r.budgets.find((b) => b.budget_id === fast_food)?.periods[0];
    expect(ff).toMatchObject({ is_paused: true, allocated_amount: 0 });
    const coffee = r.budgets.find((b) => b.budget_id === sams)?.periods[0];
    expect(coffee).toMatchObject({ is_paused: false, allocated_amount: 400 });
  });

  // S1-M4 follow-up (user decision 2026-11-02): "Auto on re-categorize".
  const DAY = 86_400_000;
  const iso_day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  async function month_page(user: string, offset: number) {
    const now = new Date();
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1);
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1) - 1;
    const d = new Date(start);
    const pid = `${d.getUTCFullYear()}M${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const ref = db.collection("source_periods").doc(pid);
    if (!(await ref.get()).exists) {
      await ref.set({
        id: pid, periodId: pid, type: "monthly", startDate: admin.firestore.Timestamp.fromMillis(start),
        endDate: admin.firestore.Timestamp.fromMillis(end), year: d.getUTCFullYear(),
      });
    }
    const r = await derive_period_orchestrator(t(), user, {
      view_cadence: "monthly", window_start_ms: start, window_end_ms: end, force: true,
    });
    return { r, start };
  }

  it("S1-M4 follow-up: giving the emptied budget a category resumes it from today; past days stay paused", async () => {
    // As if it came back 10 days ago (so there ARE past paused days to keep).
    const today_ms = Math.floor(Date.now() / DAY) * DAY;
    const past_start = today_ms - 10 * DAY;
    await db.collection("budgets").doc(fast_food).update({
      pausedRanges: [{ start: iso_day(past_start), end: "2099-12-31" }],
    });
    await update_budget_orchestrator(t(), SAM, uuid(), {
      budget_id: fast_food, category_ids: ["FOOD_AND_DRINK_VENDING_MACHINES"],
    } as never);
    const ff = await budget(fast_food);
    expect(ff.categoryIds).toEqual(["FOOD_AND_DRINK_VENDING_MACHINES"]);
    expect(ff.pausedRanges).toEqual([{ start: iso_day(past_start), end: iso_day(today_ms - DAY) }]);

    // Next month: unpaused with its full allocation.
    const next = (await month_page(SAM, 1)).r.budgets.find((b) => b.budget_id === fast_food)?.periods[0];
    expect(next).toMatchObject({ is_paused: false, allocated_amount: 400, paused_days: 0 });
    // This month: only the days before today are still paused.
    const { r, start } = await month_page(SAM, 0);
    const cur = r.budgets.find((b) => b.budget_id === fast_food)?.periods[0];
    const expected_paused = Math.max(0, (today_ms - DAY - Math.max(start, past_start)) / DAY + 1);
    expect(cur?.paused_days).toBe(expected_paused);
    // The rollover follows: a stored-spent recompute was queued for it.
    const jobs = await db.collection("_jobs").where("job_type", "==", "recompute_budget_spent").get();
    expect(jobs.docs.some((d) => (d.data().payload?.budget_ids ?? []).includes(fast_food))).toBe(true);
  });

  it("S1-M4 follow-up: a user's own pause on a budget WITH categories survives amount / name edits", async () => {
    const now = new Date();
    const s = iso_day(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const e = iso_day(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1) - 1);
    await set_budget_pause_orchestrator(t(), SAM, { budget_id: sams, start_day: s, end_day: e, paused: true });
    const before = (await budget(sams)).pausedRanges;
    expect(before).toEqual([{ start: s, end: e }]);
    await update_budget_orchestrator(t(), SAM, uuid(), { budget_id: sams, amount: 450 } as never);
    await update_budget_orchestrator(t(), SAM, uuid(), { budget_id: sams, name: "Coffee & Tea" } as never);
    expect((await budget(sams)).pausedRanges).toEqual(before);
    const next = (await month_page(SAM, 1)).r.budgets.find((b) => b.budget_id === sams)?.periods[0];
    expect(next).toMatchObject({ is_paused: true, allocated_amount: 0 });
  });

  it("verify M1: copying a budget with no categories is skipped up front; the batch still goes", async () => {
    const empty = await create(ALEX, "Emptied", ["FOOD_AND_DRINK_OTHER"]);
    await db.collection("budgets").doc(empty).update({ categoryIds: [] });
    const a = await create(ALEX, "Aaa Hobbies", ["ENTERTAINMENT_HOBBIES"]);
    const z = await create(ALEX, "Zzz Pets", ["GENERAL_MERCHANDISE_PET_SUPPLIES"]);
    const res = await copy_budgets_to_group_orchestrator(ctx(ALEX, {
      group_id, remove_from_me: false,
      items: [
        { budget_id: a, amount: 10 }, { budget_id: empty, amount: 10 }, { budget_id: z, amount: 10 },
      ],
    }));
    expect(res.success).toBe(true);
    expect(res.budget_ids).toHaveLength(2);
    expect((res as unknown as { skipped?: unknown[] }).skipped).toEqual([
      { source_budget_id: empty, name: "Emptied", reason: expect.stringMatching(/no categories/) },
    ]);
    // And it can't be moved into the group either.
    const move = await move_budget_orchestrator(ctx(ALEX, { budget_id: empty, to_group_id: group_id }));
    expect(move.success).toBe(false);
    expect(move.errors?.[0]).toMatch(/no categories/);
    expect((await budget(empty)).userId).toBe(ALEX);
  });
});
