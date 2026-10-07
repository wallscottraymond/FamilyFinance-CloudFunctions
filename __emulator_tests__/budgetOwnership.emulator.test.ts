/**
 * Budget update / delete ownership (found while building Account-Rooted-Sharing):
 * the callables run with the admin SDK, so the resolvers must refuse a budget the
 * caller doesn't own. A stranger gets "not found" (existence isn't revealed).
 */
import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "family-budget-app-cb59b" });
}
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

import { resolve_update_budget_dependencies } from "../src/functions/resolvers/budgets/update_budget.resolver";
import { resolve_delete_budget_dependencies } from "../src/functions/resolvers/budgets/delete_budget.resolver";
import { NotFoundError } from "../src/functions/types";

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const OWNER = `owner_${RUN}`;
const BUDGET = `budget_${RUN}`;
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });

beforeAll(async () => {
  const now = admin.firestore.Timestamp.now();
  await db.collection("budgets").doc(BUDGET).set({
    id: BUDGET, name: "Groceries", userId: OWNER, ownerId: OWNER, createdBy: OWNER,
    amount: 400, period: "monthly", categoryIds: [], isActive: true, isOngoing: true,
    startDate: now, createdAt: now, updatedAt: now, groupIds: [],
  });
});

it("a stranger can't update or delete someone's budget", async () => {
  await expect(
    resolve_update_budget_dependencies(ctx(), `mallory_${RUN}`, { budget_id: BUDGET, amount: 1 } as never)
  ).rejects.toBeInstanceOf(NotFoundError);
  await expect(
    resolve_delete_budget_dependencies(ctx(), `mallory_${RUN}`, BUDGET)
  ).rejects.toBeInstanceOf(NotFoundError);
});

it("the owner still can", async () => {
  await expect(
    resolve_update_budget_dependencies(ctx(), OWNER, { budget_id: BUDGET, amount: 1 } as never)
  ).resolves.toBeDefined();
  await expect(resolve_delete_budget_dependencies(ctx(), OWNER, BUDGET)).resolves.toBeDefined();
});
