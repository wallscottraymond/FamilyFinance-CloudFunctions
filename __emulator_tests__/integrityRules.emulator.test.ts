/**
 * Firestore rules — Transaction-Integrity-Review 3-S: categories, splits and budget categories
 * change only through the callables (which run the one category function + the engine); the
 * engine's server-only state is unreadable to clients.
 */
import * as fs from "fs";
import * as path from "path";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-integrity-rules",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8") },
  });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "transactions/t1"), {
      userId: "alex", ownerId: "alex", amount: 5, userNotes: "",
      splits: [{ splitId: "s1", amount: 5, budgetId: "b1", firstCategoryId: "groceries" }],
    });
    await setDoc(doc(db, "budgets/b1"), {
      userId: "alex", createdBy: "alex", name: "Groceries", amount: 100, categoryIds: ["groceries"],
      isActive: true, isOngoing: true, isSystemEverythingElse: false,
    });
    await setDoc(doc(db, "budget_periods/bp1"), {
      userId: "alex", budgetId: "b1", periodId: "2031M10", allocatedAmount: 100,
      originalAmount: 100, isActive: true, userNotes: "",
    });
    await setDoc(doc(db, "_reassign_runs/r1"), { user_id: "alex" });
    await setDoc(doc(db, "_migration_snapshots/m1"), { budgets: {} });
    await setDoc(doc(db, "_config/reassign"), { enabled: true });
  });
});

const alex = () => env.authenticatedContext("alex").firestore();

it("a client may still write notes directly", async () => {
  await assertSucceeds(updateDoc(doc(alex(), "transactions/t1"), { userNotes: "hi" }));
});

it("a client can't hide a transaction (Hide was removed — an old build can't set it)", async () => {
  await assertFails(updateDoc(doc(alex(), "transactions/t1"), { isHidden: true }));
});

it("a client can't create a transaction (could plant splits in another user's budgets)", async () => {
  await assertFails(setDoc(doc(alex(), "transactions/t2"), {
    userId: "sam", ownerId: "alex", amount: 5, splits: [{ budgetAssignmentSource: "manual", budgetId: "x" }],
  }));
});

it("a client can't write splits or category fields directly (callable only)", async () => {
  await assertFails(updateDoc(doc(alex(), "transactions/t1"), { splits: [] }));
  await assertFails(updateDoc(doc(alex(), "transactions/t1"), { category: "x" }));
  await assertFails(updateDoc(doc(alex(), "transactions/t1"), { userCategory: "x" }));
});

it("budget categories change only through update_budget; budgets are created only by callable", async () => {
  await assertFails(updateDoc(doc(alex(), "budgets/b1"), { categoryIds: [] }));
  await assertSucceeds(updateDoc(doc(alex(), "budgets/b1"), { name: "Food" }));
  await assertFails(setDoc(doc(alex(), "budgets/b2"), {
    userId: "alex", createdBy: "alex", name: "X", amount: 10, categoryIds: [], isActive: true, isOngoing: true,
  }));
});

it("engine state (runs, snapshots, kill switch) is unreadable and unwritable by clients", async () => {
  await assertFails(getDoc(doc(alex(), "_reassign_runs/r1")));
  await assertFails(getDoc(doc(alex(), "_migration_snapshots/m1")));
  await assertFails(setDoc(doc(alex(), "_config/reassign"), { enabled: false }));
});

it("a budget period's amount changes only through the callable; notes / pause stay client fields", async () => {
  const bp = () => doc(alex(), "budget_periods/bp1");
  await assertFails(updateDoc(bp(), { modifiedAmount: 50 }));
  await assertFails(updateDoc(bp(), { modifiedAmount: 50, isModified: true }));
  await assertFails(updateDoc(bp(), { isModified: true }));
  await assertFails(updateDoc(bp(), { hasPeriodAdjustment: true }));
  await assertFails(updateDoc(bp(), { periodAdjustments: [] }));
  await assertSucceeds(updateDoc(bp(), { userNotes: "hi", updatedAt: new Date() }));
  await assertSucceeds(updateDoc(bp(), { isActive: false }));
});
