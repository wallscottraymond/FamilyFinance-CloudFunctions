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
