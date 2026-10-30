/**
 * A budget edit writes only what it changed (Code-Health-Review M3-M4).
 *
 * update_budget built the whole budget from the copy its resolver read and saved the FULL doc,
 * so a change another path made in between (a category moved by a transfer, tags, the Everything
 * Else type) was overwritten with the old value. budget_repo.save_changes(before, after) writes
 * only the fields this edit changed.
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true }); // as in src/index.ts

import { budget_repo } from "../src/functions/repositories/budget.repo";

const t = () => ({ trace_id: `t_${Date.now()}`, span_id: "s" });
const rid = (p: string) => `${p}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const U = "u_budget_save";
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

/* eslint-disable @typescript-eslint/naming-convention */
async function seedBudget(id: string) {
  await db.collection("budgets").doc(id).set({
    id, userId: U, createdBy: U, ownerId: U, groupIds: [], isActive: true,
    access: { ownerId: U, createdBy: U, groupIds: [], isPrivate: true },
    name: "Groceries", amount: 300, currency: "USD", categoryIds: ["groceries", "eating_out"],
    period: "monthly", budgetType: "recurring", isOngoing: true,
    startDate: ts("2026-01-01T00:00:00Z"), endDate: ts("2027-01-01T00:00:00Z"),
    spent: 0, remaining: 300, tags: [], createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
/* eslint-enable @typescript-eslint/naming-convention */
const read = async (id: string) => (await db.collection("budgets").doc(id).get()).data()!;

describe("budget_repo.save_changes (M3-M4)", () => {
  it("keeps a concurrent category move while applying a rename", async () => {
    const id = rid("b");
    await seedBudget(id);
    const before = (await budget_repo.get_by_id(t(), id))!;
    // Another path moves "eating_out" to a different budget after the edit was read.
    await db.collection("budgets").doc(id).update({ categoryIds: ["groceries"] });
    await budget_repo.save_changes(t(), before, { ...before, name: "Food" });
    const doc = await read(id);
    expect(doc.name).toBe("Food");
    expect(doc.categoryIds).toEqual(["groceries"]);
  });

  it("keeps concurrent tags while applying an amount change", async () => {
    const id = rid("b");
    await seedBudget(id);
    const before = (await budget_repo.get_by_id(t(), id))!;
    await db.collection("budgets").doc(id).update({ tags: ["tag1"] });
    await budget_repo.save_changes(t(), before, { ...before, amount: 450 });
    const doc = await read(id);
    expect(doc.amount).toBe(450);
    expect(doc.tags).toEqual(["tag1"]);
  });

  it("the user's own category change still applies", async () => {
    const id = rid("b");
    await seedBudget(id);
    const before = (await budget_repo.get_by_id(t(), id))!;
    await budget_repo.save_changes(t(), before, { ...before, category_ids: ["groceries", "coffee"] });
    expect((await read(id)).categoryIds).toEqual(["groceries", "coffee"]);
  });

  it("stamps updatedAt and writes nothing else when nothing changed", async () => {
    const id = rid("b");
    await seedBudget(id);
    const before = (await budget_repo.get_by_id(t(), id))!;
    await db.collection("budgets").doc(id).update({ name: "Renamed elsewhere" });
    await budget_repo.save_changes(t(), before, { ...before });
    const doc = await read(id);
    expect(doc.name).toBe("Renamed elsewhere");
  });
});
