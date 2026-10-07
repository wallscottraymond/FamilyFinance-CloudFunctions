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

  it("T-LV-04a a leaver's moved-in budget goes back to them; group-made budgets stay", async () => {
    const sams = await create(SAM, "Coffee", ["FOOD_AND_DRINK_COFFEE"]);
    expect((await move_budget_orchestrator(ctx(SAM, { budget_id: sams, to_group_id: group_id }))).success)
      .toBe(true);
    expect((await manage_group_orchestrator(ctx(SAM, { group_id, action: "leave" }))).success).toBe(true);
    const back = await budget(sams);
    expect(back.userId).toBe(SAM);
    expect(back.broughtBy ?? null).toBeNull();
    expect((await budget(groceries)).userId).toBe(KEY); // Alex's moved-in budget stays (Alex didn't leave)
  });
});
