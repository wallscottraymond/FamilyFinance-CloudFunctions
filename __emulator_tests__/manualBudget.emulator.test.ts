/**
 * Manual budgets (AF-02): one is created with no categories, counts only what's pinned to it, and
 * saving other budget fields keeps its checklist. Nov 2034.
 *
 * Prereq: firebase emulators:exec --only firestore \
 *   "npx jest --selectProjects emulator --testPathPattern manualBudget"
 */
import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

import { create_budget_orchestrator } from "../src/functions/orchestrators/budgets/create_budget.orchestrator";
import { budget_repo } from "../src/functions/repositories/budget.repo";
import { budget_checklist_repo } from "../src/functions/repositories/budget_checklist.repo";
import { create_budget_input_schema } from "../src/functions/types/budgets/create_budget.types";
import { process_budget_created_orchestrator } from "../src/functions/orchestrators/budgets/process_budget_created.orchestrator";
import { process_budget_updated_orchestrator } from "../src/functions/orchestrators/budgets/process_budget_updated.orchestrator";
import { update_budget_orchestrator } from "../src/functions/orchestrators/budgets/update_budget.orchestrator";
import { resolve_period_derivation_deps } from "../src/functions/resolvers/periods/period_derivation.resolver";
import { compute_period_view } from "../src/functions/domain/periods/period_view.service";
import { derive_addable_transactions_orchestrator } from "../src/functions/orchestrators/budgets/derive_budget_transactions.orchestrator";

const U = "manual_budget_user";
const ctx = { trace_id: "t", span_id: "s", user_id: U } as never;

const base = {
  name: "Christmas", amount: 500, period: "monthly", start_date: "2034-11-01T00:00:00.000Z",
  budget_type: "recurring", alert_threshold: 80, is_shared: false, is_ongoing: true,
};

describe("manual budgets", () => {
  it("the request needs a category unless it's manual", () => {
    const req = { ...base, idempotency_key: "k", category_ids: [] };
    expect(create_budget_input_schema.safeParse(req).success).toBe(false);
    expect(create_budget_input_schema.safeParse({ ...req, is_manual: true }).success).toBe(true);
  });

  it("is created with no categories, and stays manual through a save", async () => {
    const r = await create_budget_orchestrator(ctx, U, "idem1", { ...base, category_ids: [], is_manual: true } as never);
    const id = (r as { budget_id?: string; id?: string }).budget_id ?? (r as { id?: string }).id;
    expect(id).toBeTruthy();
    const doc = (await db.collection("budgets").doc(id as string).get()).data()!;
    expect(doc.isManual).toBe(true);
    expect(doc.categoryIds).toEqual([]);
    const entity = await budget_repo.get_by_id(ctx, id as string);
    expect(entity?.is_manual).toBe(true);
    await budget_repo.save(ctx, { ...entity!, name: "Christmas 2034" } as never);
    const after = (await db.collection("budgets").doc(id as string).get()).data()!;
    expect(after.name).toBe("Christmas 2034");
    expect(after.isManual).toBe(true);
  });

  it("a list entered while creating is saved under the budget's owner, and a retry doesn't double it", async () => {
    const input = {
      ...base, name: "Gifts", category_ids: [], is_manual: true,
      checklist_items: [{ id: "a", name: "Train set", estimate: 100 }, { id: "b", name: "Bike", estimate: 200 }],
    };
    const r = await create_budget_orchestrator(ctx, U, "idem_list", input as never);
    const stored = (await db.collection("budget_checklists").doc(r.budget_id).get()).data()!;
    expect(stored.userId).toBe(U);
    expect((await budget_checklist_repo.get(r.budget_id)).items.map((i) => i.estimate)).toEqual([100, 200]);
    await create_budget_orchestrator(ctx, U, "idem_list", input as never);
    expect((await budget_checklist_repo.get(r.budget_id)).items).toHaveLength(2);
  });

  it("no list: no checklist doc", async () => {
    const r = await create_budget_orchestrator(ctx, U, "idem_nolist", { ...base, name: "Plain", category_ids: [], is_manual: true } as never);
    expect((await db.collection("budget_checklists").doc(r.budget_id).get()).exists).toBe(false);
  });

  it("the request refuses a blank item name and more than 100 items", () => {
    const req = { ...base, idempotency_key: "k", category_ids: [], is_manual: true };
    const item = { id: "a", name: "x", estimate: 1 };
    expect(create_budget_input_schema.safeParse({ ...req, checklist_items: [{ ...item, name: "  " }] }).success).toBe(false);
    expect(create_budget_input_schema.safeParse({ ...req, checklist_items: Array(101).fill(item) }).success).toBe(false);
    expect(create_budget_input_schema.safeParse({ ...req, checklist_items: [item] }).success).toBe(true);
  });

  it("Add lists only what a pin would land on", async () => {
    const { Timestamp } = admin.firestore;
    const D = (m: number, d: number) => Date.UTC(2034, m, d);
    const budget = await create_budget_orchestrator(ctx, U, "idem2", {
      ...base, name: "Trip", start_date: "2034-11-05T00:00:00.000Z", category_ids: [], is_manual: true,
      is_ongoing: false, budget_end_date: "2034-11-20T00:00:00.000Z", budget_type: "limited",
    } as never);
    const id = ((budget as { budget_id?: string }).budget_id ?? (budget as { id?: string }).id) as string;
    await db.collection("budgets").doc("mb_ee").set({
      id: "mb_ee", name: "Everything Else", userId: U, ownerId: U, createdBy: U, groupIds: [], isActive: true,
      isSystemEverythingElse: true, period: "monthly", budgetType: "recurring", amount: 0, categoryIds: [],
      startDate: Timestamp.fromMillis(Date.UTC(2030, 0, 1)), createdAt: Timestamp.now(),
    });
    await db.collection("source_periods").doc("2034M11").set({
      id: "2034M11", periodId: "2034M11", type: "monthly", year: 2034, index: 11,
      startDate: Timestamp.fromMillis(D(10, 1)), endDate: Timestamp.fromMillis(Date.UTC(2034, 10, 30, 23, 59, 59, 999)),
    });
    const txn = (key: string, day: number, type: string, code: string, split: Record<string, unknown> = {}) =>
      db.collection("transactions").doc(`mb_${key}`).set({
        transactionId: `mb_${key}`, userId: U, ownerId: U, groupIds: [], isActive: true, isDeleted: false, source: "plaid",
        name: key, merchantName: key, amount: 10, type, accountId: "mb_chk", currency: "USD", isPending: false,
        transactionDate: Timestamp.fromMillis(D(10, day)), plaidDetailedCategory: code,
        splits: [{ splitId: `s_${key}`, amount: 10, plaidDetailedCategory: code, outflowId: null, inflowId: null, ...split }],
      });
    await txn("gift", 10, "expense", "OTHER_EXPENSE");
    await txn("before", 2, "expense", "OTHER_EXPENSE");
    await txn("after", 25, "expense", "OTHER_EXPENSE");
    await txn("pay", 10, "income", "INCOME_WAGES");
    await txn("xfer", 10, "expense", "TRANSFER_OUT_ACCOUNT_TRANSFER");
    await txn("bill", 10, "expense", "OTHER_EXPENSE", { outflowId: "some_bill" });
    await txn("in", 10, "expense", "OTHER_EXPENSE", { budgetAssignmentSource: "manual", budgetId: id });
    const rows = await derive_addable_transactions_orchestrator(
      ctx, U, id, D(10, 1), Date.UTC(2034, 10, 30, 23, 59, 59, 999)
    );
    // Nov 2 lands: a budget's start snaps back to its period's start (see budget start period-snap).
    // Nov 25 is past the end date, so a pin there wouldn't land.
    expect(rows.map((r) => r.name).sort()).toEqual(["before", "gift"]);
    const gift = rows.find((r) => r.name === "gift");
    expect(gift?.current_budget_name).toBe("Everything Else");
    expect(gift?.split_id).toBe("s_gift");
    // A paused day's spending stays in Everything Else, so a pin wouldn't land.
    await db.collection("budgets").doc(id).update({ pausedRanges: [{ start: "2034-11-10", end: "2034-11-10" }] });
    const paused = await derive_addable_transactions_orchestrator(ctx, U, id, D(10, 1), Date.UTC(2034, 10, 30, 23, 59, 59, 999));
    expect(paused.map((r) => r.name)).toEqual(["before"]);
  });

  it("the checklist lives in its own doc, so a tick isn't a budget write", async () => {
    const r = await create_budget_orchestrator(ctx, U, "idem3", { ...base, name: "List", category_ids: [], is_manual: true } as never);
    const id = ((r as { budget_id?: string }).budget_id ?? (r as { id?: string }).id) as string;
    const before = (await db.collection("budgets").doc(id).get()).data()!;
    await budget_checklist_repo.apply(id, U, { op: "add", id: "a", name: "Bike", estimate: 300, period_key: "2034-11" });
    await Promise.all([
      budget_checklist_repo.apply(id, U, { op: "add", id: "b", name: "Lego", estimate: 40, period_key: "2034-11" }),
      budget_checklist_repo.apply(id, U, { op: "tick", id: "a", period_key: "2034-11", ticked: true }),
    ]);
    const list = await budget_checklist_repo.get(id);
    expect(list.items.map((i) => i.id).sort()).toEqual(["a", "b"]);
    expect(list.ticks["2034-11"]).toEqual(["a"]);
    const after = (await db.collection("budgets").doc(id).get()).data()!;
    expect(after).toEqual(before);
    await budget_checklist_repo.delete(id);
    expect((await budget_checklist_repo.get(id)).items).toEqual([]);
  });
});

describe("funds", () => {
  const { Timestamp } = admin.firestore;
  const F = "fund_user";
  const fctx = { trace_id: "t", span_id: "s", user_id: F } as never;
  const month = (m: number) => ({
    start: Date.UTC(2035, m, 1),
    end: Date.UTC(2035, m + 1, 0, 23, 59, 59, 999),
  });
  let id = "";

  const view = async (m: number) => {
    const { start, end } = month(m);
    const deps = await resolve_period_derivation_deps(fctx, F, "monthly", start, end);
    const result = compute_period_view(deps, "monthly");
    return result.budgets.find((b) => b.budget_id === id);
  };

  beforeAll(async () => {
    for (const m of [9, 10, 11]) {
      const { start, end } = month(m);
      const pid = `2035M${m + 1}`;
      await db.collection("source_periods").doc(pid).set({
        id: pid, periodId: pid, type: "monthly", year: 2035, index: m + 1,
        startDate: Timestamp.fromMillis(start), endDate: Timestamp.fromMillis(end),
      });
    }
    await db.collection("budgets").doc("fund_ee").set({
      id: "fund_ee", name: "Everything Else", userId: F, ownerId: F, createdBy: F, groupIds: [], isActive: true,
      isSystemEverythingElse: true, period: "monthly", budgetType: "recurring", amount: 0, categoryIds: [],
      startDate: Timestamp.fromMillis(Date.UTC(2030, 0, 1)), createdAt: Timestamp.now(),
    });
    const res = await create_budget_orchestrator(fctx, F, "idem_fund", {
      name: "Christmas", amount: 300, category_ids: [], is_manual: true, is_fund: true, period: "monthly",
      budget_type: "limited", start_date: "2035-10-01T00:00:00.000Z", budget_end_date: "2035-12-31T00:00:00.000Z",
      alert_threshold: 80, is_shared: false, is_ongoing: false,
    } as never);
    id = res.budget_id;
    const pin = (key: string, ms: number, amount: number) => db.collection("transactions").doc(key).set({
      transactionId: key, userId: F, ownerId: F, groupIds: [], isActive: true, isDeleted: false, source: "plaid",
      transactionDate: Timestamp.fromMillis(ms), isPending: false, type: "expense", name: key,
      accountId: "a", splitBudgetIds: [id],
      splits: [{ splitId: key, id: key, amount, budgetId: id, budgetAssignmentSource: "manual" }],
    });
    await pin("fund_oct", Date.UTC(2035, 9, 10), 100);
    await pin("fund_nov", Date.UTC(2035, 10, 10), 150);
  });

  it("is stored as a fund: the total, no categories, no rollover", async () => {
    const doc = (await db.collection("budgets").doc(id).get()).data()!;
    expect(doc.isFund).toBe(true);
    expect(doc.isManual).toBe(true);
    expect(doc.amount).toBe(300);
    expect(doc.categoryIds).toEqual([]);
    expect(doc.rolloverEnabled).toBe(false);
  });

  it("before its periods exist, a month is planned at the share, never the whole total", async () => {
    const p = (await view(9))!.periods[0];
    expect(p.allocated_amount).toBe(100);
    expect(p.effective_amount).toBe(100);
  });

  it("each month sets aside the share and shows its own spend, and what's left runs down across months", async () => {
    await process_budget_created_orchestrator(fctx, {
      budget_id: id, is_fund: true, user_id: F, group_ids: [], budget_name: "Christmas", category_ids: [], amount: 100,
      cadence: "monthly", start_ms: Date.UTC(2035, 9, 1), generation_end_ms: Date.UTC(2035, 11, 31),
      is_recurring: false, claims: [], everything_else_budget_id: "fund_ee", rehome_from_ms: Date.UTC(2035, 9, 1),
    } as never);
    const docs = await db.collection("budget_periods").where("budgetId", "==", id).get();
    expect(docs.docs.every((d) => d.data().isFund === true && d.data().fundEndMs === Date.UTC(2035, 11, 31))).toBe(true);
    const oct = (await view(9))!;
    expect(oct.is_fund).toBe(true);
    expect(oct.periods[0]).toMatchObject({ allocated_amount: 100, spent: 100, remaining: 200, fund_total: 300, fund_spent_to_date: 100 });
    const nov = (await view(10))!.periods[0];
    expect(nov).toMatchObject({ allocated_amount: 100, spent: 150, remaining: 50, fund_spent_to_date: 250 });
    const dec = (await view(11))!.periods[0];
    expect(dec).toMatchObject({ allocated_amount: 100, spent: 0, remaining: 50, fund_spent_to_date: 250 });
  });

  it("spending a fund doesn't take from Everything Else; only the share does", async () => {
    const { start, end } = month(10);
    const deps = await resolve_period_derivation_deps(fctx, F, "monthly", start, end);
    const ee = compute_period_view(deps, "monthly").budgets.find((b) => b.is_everything_else)!;
    expect(ee.periods[0].spent).toBe(0);
    expect(ee.periods[0].allocated_amount).toBe(-100);
  });

  it("changing the total re-spreads it over the months left", async () => {
    await process_budget_updated_orchestrator(fctx, {
      budget_id: id, fund_total: 600, user_id: F, group_ids: [], budget_name: "Christmas", category_ids: [], amount: 600,
      cadence: "monthly", start_ms: Date.UTC(2035, 9, 1), generation_end_ms: Date.UTC(2035, 11, 31), is_recurring: false,
      added_claims: [], released_category_ids: [], everything_else_budget_id: "fund_ee", rehome_from_ms: Date.UTC(2035, 9, 1),
      range_changed: false, regenerate_periods: true, name_changed: false,
    } as never);
    const snap = await db.collection("budget_periods").where("budgetId", "==", id).where("periodType", "==", "monthly").get();
    expect(snap.docs.map((d) => d.data().allocatedAmount)).toEqual([200, 200, 200]);
  });

  it("edited before its periods exist: months get the share, never the total", async () => {
    const res = await create_budget_orchestrator(fctx, F, "idem_fund2", {
      name: "Trip", amount: 300, category_ids: [], is_manual: true, is_fund: true, period: "monthly",
      budget_type: "limited", start_date: "2035-10-01T00:00:00.000Z", budget_end_date: "2035-12-31T00:00:00.000Z",
      alert_threshold: 80, is_shared: false, is_ongoing: false,
    } as never);
    await process_budget_updated_orchestrator(fctx, {
      budget_id: res.budget_id, fund_total: 600, user_id: F, group_ids: [], budget_name: "Trip", category_ids: [], amount: 600,
      cadence: "monthly", start_ms: Date.UTC(2035, 9, 1), generation_end_ms: Date.UTC(2035, 11, 31), is_recurring: false,
      added_claims: [], released_category_ids: [], everything_else_budget_id: "fund_ee", rehome_from_ms: Date.UTC(2035, 9, 1),
      range_changed: false, regenerate_periods: true, name_changed: false,
    } as never);
    const snap = await db.collection("budget_periods").where("budgetId", "==", res.budget_id).where("periodType", "==", "monthly").get();
    expect(snap.docs.map((d) => d.data().allocatedAmount)).toEqual([200, 200, 200]);
  });

  it("the create job prices from the stored total, in case it was edited first", async () => {
    const res = await create_budget_orchestrator(fctx, F, "idem_fund3", {
      name: "Gifts", amount: 300, category_ids: [], is_manual: true, is_fund: true, period: "monthly",
      budget_type: "limited", start_date: "2035-10-01T00:00:00.000Z", budget_end_date: "2035-12-31T00:00:00.000Z",
      alert_threshold: 80, is_shared: false, is_ongoing: false,
    } as never);
    await db.collection("budgets").doc(res.budget_id).update({ amount: 900 });
    await process_budget_created_orchestrator(fctx, {
      budget_id: res.budget_id, is_fund: true, user_id: F, group_ids: [], budget_name: "Gifts", category_ids: [], amount: 100,
      cadence: "monthly", start_ms: Date.UTC(2035, 9, 1), generation_end_ms: Date.UTC(2035, 11, 31),
      is_recurring: false, claims: [], everything_else_budget_id: "fund_ee", rehome_from_ms: Date.UTC(2035, 9, 1),
    } as never);
    const snap = await db.collection("budget_periods").where("budgetId", "==", res.budget_id).where("periodType", "==", "monthly").get();
    expect(snap.docs.map((d) => d.data().allocatedAmount)).toEqual([300, 300, 300]);
  });

  it("refuses a new end date", async () => {
    await expect(update_budget_orchestrator(fctx, F, "idem_fund_end", {
      budget_id: id, budget_end_date: "2036-01-31T00:00:00.000Z",
    } as never)).rejects.toThrow();
  });

  it("the request needs an end date", () => {
    const req = { name: "x", amount: 1, category_ids: [], period: "monthly", start_date: "2035-01-01", idempotency_key: "k", is_fund: true };
    expect(create_budget_input_schema.safeParse(req).success).toBe(false);
    expect(create_budget_input_schema.safeParse({ ...req, is_manual: true, budget_end_date: "2035-03-01" }).success).toBe(true);
  });
});
