/**
 * Budget read callables (security audit 2026-10-07): getPersonalBudgets returns only budgets the
 * caller OWNS (userId), not ones they created; getFamilyBudgets never returns other users' data.
 */
import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "family-budget-app-cb59b" });
}
const db = admin.firestore();

import { getPersonalBudgets } from "../src/functions/budgets/api/queries/getPersonalBudgets";
import { getFamilyBudgets } from "../src/functions/budgets/api/queries/getFamilyBudgets";

type Runnable = { run: (r: unknown) => Promise<unknown> };
const call = (fn: unknown, uid: string, data: unknown = {}) =>
  (fn as Runnable).run({ auth: { uid, token: { uid } }, data });

beforeEach(async () => {
  // Only this suite's own docs (the emulator is shared by parallel suites — a collection-wide
  // wipe deleted other suites' users / budgets mid-run).
  const mine = await db.collection("budgets").where("userId", "in", ["br_alex", "br_sam"]).get();
  await Promise.all(mine.docs.map((d) => d.ref.delete()));
  const user = (familyId?: string) => ({ email: "x@example.com", role: "editor", isActive: true, ...(familyId ? { familyId } : {}) });
  const budget = (userId: string, createdBy: string, name: string, ms: number) => ({
    userId, createdBy, name, amount: 10, isActive: true, familyId: "fam1",
    createdAt: admin.firestore.Timestamp.fromMillis(ms),
  });
  await Promise.all([
    db.doc("users/br_alex").set(user("fam1")),
    db.doc("users/br_sam").set(user("fam1")),
    db.doc("budgets/a1").set(budget("br_alex", "br_alex", "Old", 1000)),
    db.doc("budgets/a2").set(budget("br_alex", "br_alex", "New", 2000)),
    db.doc("budgets/handed").set(budget("br_alex", "br_sam", "Handed to Alex", 1500)),
    db.doc("budgets/s1").set(budget("br_sam", "br_sam", "Sam's", 3000)),
  ]);
});

it("T-BR-01 getPersonalBudgets: the caller's owned budgets, newest first; not ones they only created", async () => {
  const alex = (await call(getPersonalBudgets, "br_alex")) as Array<{ id: string }>;
  expect(alex.map((b) => b.id)).toEqual(["a2", "handed", "a1"]);
  const sam = (await call(getPersonalBudgets, "br_sam")) as Array<{ id: string }>;
  expect(sam.map((b) => b.id)).toEqual(["s1"]);
});

it("T-BR-02 getFamilyBudgets: a shared familyId no longer reads others' budgets (no-family answer)", async () => {
  await expect(call(getFamilyBudgets, "br_alex")).rejects.toMatchObject({
    code: "failed-precondition",
    message: "User must belong to a family",
  });
});
