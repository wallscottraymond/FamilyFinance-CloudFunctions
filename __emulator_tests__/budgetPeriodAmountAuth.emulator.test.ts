/**
 * updateBudgetPeriodAmount ownership (Account-Rooted-Sharing; security fix).
 * Before: `period.userId !== uid && period.createdBy !== uid` and then ANY editor/admin role
 * passed — every user is an editor, so anyone could edit anyone's budget period.
 * Now: the parent budget's owner (userId) must be the caller (hotfix base, pre-sharing).
 *
 * Run: firebase emulators:exec --only firestore --project demo-x \
 *   "npx jest --selectProjects emulator --testPathPattern budgetPeriodAmountAuth"
 */
import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "family-budget-app-cb59b" });
}
const db = admin.firestore();

import { Timestamp } from "firebase-admin/firestore";
import { updateBudgetPeriodAmount } from "../src/functions/budgets/api/periods/updateBudgetPeriodAmount";

const DAY = 86_400_000;
const start = Timestamp.fromMillis(Date.now() - 2 * DAY);
const end = Timestamp.fromMillis(Date.now() + 20 * DAY);

const call = (uid: string, budgetPeriodId: string, newAmount = 321) =>
  (updateBudgetPeriodAmount as unknown as { run: (r: unknown) => Promise<{ success: boolean }> }).run({
    auth: { uid, token: { uid } },
    data: { budgetPeriodId, newAmount, cascadeScope: "this_period" },
  });

const user = (role: string) => ({ email: "x@example.com", role, isActive: true });
const budget = (userId: string, createdBy: string) => ({
  userId, createdBy, name: "B", amount: 100, isActive: true, isSystemEverythingElse: false,
});
const period = (budgetId: string, userId: string, createdBy: string) => ({
  budgetId, userId, createdBy, periodId: "P", sourcePeriodId: "P", periodType: "monthly",
  periodStart: start, periodEnd: end, allocatedAmount: 100, originalAmount: 100,
  isPrime: true, isActive: true, spent: 0,
});

beforeEach(async () => {
  const cols = ["users", "budgets", "budget_periods"];
  for (const c of cols) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await Promise.all([
    db.doc("users/alex").set(user("editor")),
    db.doc("users/sam").set(user("editor")),
    db.doc("users/mallory").set(user("admin")),
    db.doc("budgets/mine").set(budget("alex", "alex")),
    db.doc("budget_periods/mine_P").set(period("mine", "alex", "alex")),
    // createdBy differs from the owner (e.g. a budget handed over): only the owner may edit.
    db.doc("budgets/moved").set(budget("alex", "sam")),
    db.doc("budget_periods/moved_P").set(period("moved", "alex", "sam")),
  ]);
});

const amountOf = async (id: string) => {
  const d = (await db.doc(`budget_periods/${id}`).get()).data()!;
  return d.isModified ? d.modifiedAmount : d.allocatedAmount;
};

it("T-BPA-01 the owner edits their own period", async () => {
  await expect(call("alex", "mine_P")).resolves.toMatchObject({ success: true });
  expect(await amountOf("mine_P")).toBe(321);
});

it("T-BPA-02 another user — even with the admin family role — can't edit it (not found)", async () => {
  await expect(call("mallory", "mine_P")).rejects.toMatchObject({ code: "not-found" });
  await expect(call("sam", "mine_P")).rejects.toMatchObject({ code: "not-found" });
  expect(await amountOf("mine_P")).toBe(100);
});

it("T-BPA-04 the creator who is not the owner can't edit", async () => {
  await expect(call("sam", "moved_P")).rejects.toMatchObject({ code: "not-found" });
  await expect(call("alex", "moved_P", 140)).resolves.toMatchObject({ success: true });
  expect(await amountOf("moved_P")).toBe(140);
});
