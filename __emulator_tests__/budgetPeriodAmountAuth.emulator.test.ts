/**
 * updateBudgetPeriodAmount ownership (Account-Rooted-Sharing; security fix).
 * Before: `period.userId !== uid && period.createdBy !== uid` and then ANY editor/admin role
 * passed — every user is an editor, so anyone could edit anyone's budget period.
 * Now: the parent budget's current view decides (Me = the uid; a group = its members).
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

const groupDoc = (memberIds: string[]) => ({
  name: "The Walls", ownerId: "alex", memberIds, createdAt: start, deletedAt: null,
  members: Object.fromEntries(memberIds.map((u) => [u, { role: u === "alex" ? "owner" : "member", joinedAt: start }])),
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
  const cols = ["users", "groups", "budgets", "budget_periods"];
  for (const c of cols) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await Promise.all([
    db.doc("users/alex").set(user("editor")),
    db.doc("users/sam").set(user("editor")),
    db.doc("users/mallory").set(user("admin")),
    db.doc("groups/g1").set(groupDoc(["alex", "sam"])),
    db.doc("budgets/mine").set(budget("alex", "alex")),
    db.doc("budget_periods/mine_P").set(period("mine", "alex", "alex")),
    db.doc("budgets/grp").set(budget("group:g1", "sam")),
    db.doc("budget_periods/grp_P").set(period("grp", "group:g1", "sam")),
    // Sam made it in the group; Alex moved it to Alex's Me (periods re-keyed, creator kept).
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

it("T-BPA-03 any group member edits a group period; outsiders can't", async () => {
  await expect(call("alex", "grp_P", 250)).resolves.toMatchObject({ success: true });
  expect(await amountOf("grp_P")).toBe(250);
  await expect(call("sam", "grp_P", 260)).resolves.toMatchObject({ success: true });
  await expect(call("mallory", "grp_P")).rejects.toMatchObject({ code: "not-found" });
  expect(await amountOf("grp_P")).toBe(260);
});

it("T-BPA-04 the creator loses edit once the budget moves to someone else's Me", async () => {
  await expect(call("sam", "moved_P")).rejects.toMatchObject({ code: "not-found" });
  await expect(call("alex", "moved_P", 140)).resolves.toMatchObject({ success: true });
  expect(await amountOf("moved_P")).toBe(140);
});

it("T-BPA-05 a member who left the group loses edit", async () => {
  await db.doc("groups/g1").set(groupDoc(["alex"]));
  await expect(call("sam", "grp_P")).rejects.toMatchObject({ code: "not-found" });
});
