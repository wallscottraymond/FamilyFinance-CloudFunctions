/**
 * Account-Rooted-Sharing security rules (Rules §3, tests T-SR-*).
 * Loads the REAL firestore.rules.
 *
 * - users can't write their own groupIds (server-written mirror)
 * - groups: members read; nobody writes from the client
 * - connect_codes / connections / requests / reports: closed to clients
 * - group stamps no longer grant access to another user's data (owner-only)
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

const preferences = {
  currency: "USD", locale: "en-US", theme: "auto",
  notifications: { email: true, push: true, transactionAlerts: true, budgetAlerts: true, weeklyReports: false },
  privacy: {
    shareSpendingWithFamily: true, shareGoalsWithFamily: true, allowFamilyToSeeTransactionDetails: true,
    showProfileToFamilyMembers: true, dataRetentionPeriod: 365, allowAnalytics: true, allowMarketingEmails: false,
  },
  display: {
    dateFormat: "MM/DD/YYYY", timeFormat: "12h", numberFormat: "US", showCentsInDisplays: true, defaultTransactionView: "list",
    periodView: {
      defaultPeriodType: "monthly", incomeTileSize: "medium", budgetsTileSize: "medium", billsTileSize: "medium",
      incomeAccordionOpen: true, budgetsAccordionOpen: true, billsAccordionOpen: true,
    },
  },
  accessibility: {
    fontSize: "medium", highContrast: false, reduceMotion: false, screenReaderOptimized: false,
    voiceOverEnabled: false, hapticFeedback: true, longPressDelay: 500,
  },
  financial: {
    autoCategorizationEnabled: true, roundUpSavings: false, budgetStartDay: 1, showNetWorth: true,
    hiddenAccounts: [], defaultBudgetAlertThreshold: 80, enableSpendingLimits: false,
  },
  security: {
    biometricAuthEnabled: false, pinAuthEnabled: false, autoLockTimeout: 300, requireAuthForTransactions: false,
    requireAuthForBudgetChanges: false, requireAuthForGoalChanges: false, sessionTimeout: 3600,
    allowedDevices: [], twoFactorAuthEnabled: false, suspiciousActivityDetection: true,
  },
};

const userDoc = (groupIds: string[]) => ({
  email: "x@example.com", displayName: "Calm Otter", role: "parent", isActive: true, preferences, groupIds,
});

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-sharing-rules",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8") },
  });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/alex"), userDoc(["g1"]));
    await setDoc(doc(db, "users/sam"), userDoc(["g1"]));
    await setDoc(doc(db, "users/mallory"), userDoc([]));
    await setDoc(doc(db, "groups/g1"), { name: "The Walls", ownerId: "alex", memberIds: ["alex", "sam"] });
    await setDoc(doc(db, "connections/alex__sam"), { userIds: ["alex", "sam"], status: "connected" });
    await setDoc(doc(db, "requests/r1"), { fromUserId: "alex", toUserId: "sam", status: "pending" });
    await setDoc(doc(db, "connect_codes/alex"), { code: "ABC234" });
    await setDoc(doc(db, "reports/x"), { reporterId: "sam", reportedId: "mallory" });
    // Old-style group-stamped transaction owned by Alex.
    await setDoc(doc(db, "transactions/t1"), { userId: "alex", ownerId: "alex", groupIds: ["g1"], amount: 5 });
  });
});

it("T-SR-01 a user can't add a group id to their own profile (create or update)", async () => {
  const db = env.authenticatedContext("mallory").firestore();
  await assertFails(updateDoc(doc(db, "users/mallory"), { groupIds: ["g1"] }));
  await assertSucceeds(updateDoc(doc(db, "users/mallory"), { displayName: "Bright Finch" }));
  const fresh = env.authenticatedContext("newbie").firestore();
  await assertFails(setDoc(doc(fresh, "users/newbie"), { ...userDoc(["g1"]), role: "viewer" }));
});

it("T-SR-02 groups: members read, non-members don't, nobody writes", async () => {
  await assertSucceeds(getDoc(doc(env.authenticatedContext("sam").firestore(), "groups/g1")));
  await assertFails(getDoc(doc(env.authenticatedContext("mallory").firestore(), "groups/g1")));
  const alex = env.authenticatedContext("alex").firestore();
  await assertFails(updateDoc(doc(alex, "groups/g1"), { name: "Mine" }));
  await assertFails(setDoc(doc(alex, "groups/g2"), { name: "New", ownerId: "alex", memberIds: ["alex"] }));
});

it("T-SR-03 sharing collections are closed to clients", async () => {
  const alex = env.authenticatedContext("alex").firestore();
  const sam = env.authenticatedContext("sam").firestore();
  await assertFails(getDoc(doc(alex, "connections/alex__sam")));
  await assertFails(getDoc(doc(sam, "requests/r1")));
  await assertFails(getDoc(doc(alex, "connect_codes/alex")));
  await assertFails(getDoc(doc(sam, "reports/x")));
  await assertFails(setDoc(doc(sam, "requests/r2"), { fromUserId: "sam", toUserId: "alex" }));
});

it("T-SR-04 a group stamp no longer lets another member read the owner's data", async () => {
  await assertSucceeds(getDoc(doc(env.authenticatedContext("alex").firestore(), "transactions/t1")));
  await assertFails(getDoc(doc(env.authenticatedContext("sam").firestore(), "transactions/t1")));
});

it("T-SR-05 an account owner can't set placement themselves (server-written)", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "accounts/a1"), { userId: "alex", name: "Checking", placement: null });
  });
  const alex = env.authenticatedContext("alex").firestore();
  await assertSucceeds(updateDoc(doc(alex, "accounts/a1"), { name: "Main" }));
  await assertFails(updateDoc(doc(alex, "accounts/a1"), { placement: { groupId: "g1" } }));
  await assertFails(setDoc(doc(alex, "accounts/a2"), { userId: "alex", placement: { groupId: "g1" } }));
  await assertSucceeds(setDoc(doc(alex, "accounts/a3"), { userId: "alex", name: "New" }));
});

it("T-SR-06 group members read the group's budgets + budget periods; others can't; no client writes", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "budgets/gb1"), { userId: "group:g1", createdBy: "alex", name: "Groceries", amount: 600 });
    await setDoc(doc(db, "budget_periods/gb1_2026M10"), { userId: "group:g1", budgetId: "gb1", allocatedAmount: 600 });
    await setDoc(doc(db, "budgets/mb1"), { userId: "alex", createdBy: "alex", name: "Mine", amount: 50 });
    // A look-alike key for a group that doesn't exist / a group Sam isn't in.
    await setDoc(doc(db, "budgets/gx"), { userId: "group:nope", createdBy: "mallory", name: "X", amount: 1 });
    await setDoc(doc(db, "groups/g2"), { name: "Other", ownerId: "mallory", memberIds: ["mallory"] });
    await setDoc(doc(db, "budgets/gb2"), { userId: "group:g2", createdBy: "mallory", name: "Theirs", amount: 1 });
  });
  const alex = env.authenticatedContext("alex").firestore();
  const sam = env.authenticatedContext("sam").firestore();
  const mallory = env.authenticatedContext("mallory").firestore();

  await assertSucceeds(getDoc(doc(sam, "budgets/gb1")));
  await assertSucceeds(getDoc(doc(sam, "budget_periods/gb1_2026M10")));
  await assertSucceeds(getDoc(doc(alex, "budgets/gb1")));
  await assertFails(getDoc(doc(mallory, "budgets/gb1")));
  await assertFails(getDoc(doc(mallory, "budget_periods/gb1_2026M10")));
  // Membership doesn't leak a member's private (Me) budgets.
  await assertFails(getDoc(doc(sam, "budgets/mb1")));
  await assertFails(getDoc(doc(sam, "budgets/gx")));
  await assertFails(getDoc(doc(sam, "budgets/gb2")));
  await assertSucceeds(getDoc(doc(mallory, "budgets/gb2")));
  // Reading doesn't open client writes to group docs (callables only).
  await assertFails(updateDoc(doc(sam, "budget_periods/gb1_2026M10"), { allocatedAmount: 1 }));
  await assertFails(updateDoc(doc(sam, "budgets/gb1"), { amount: 1 }));
});

it("T-SR-07 budget client-updates follow the current owner (userId), not the creator", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Sam made it in the group; Alex later moved it to Alex's Me.
    await setDoc(doc(db, "budgets/moved"), { userId: "alex", createdBy: "sam", name: "Gas", amount: 100, isSystemEverythingElse: false });
    await setDoc(doc(db, "budgets/grp"), { userId: "group:g1", createdBy: "sam", name: "Food", amount: 100, isSystemEverythingElse: false });
    await setDoc(doc(db, "budgets/own"), { userId: "sam", createdBy: "sam", name: "Mine", amount: 100, isSystemEverythingElse: false });
  });
  const alex = env.authenticatedContext("alex").firestore();
  const sam = env.authenticatedContext("sam").firestore();
  await assertFails(updateDoc(doc(sam, "budgets/moved"), { amount: 1 }));
  await assertSucceeds(updateDoc(doc(alex, "budgets/moved"), { amount: 120 }));
  await assertFails(updateDoc(doc(sam, "budgets/grp"), { isActive: false }));
  await assertSucceeds(updateDoc(doc(sam, "budgets/own"), { amount: 90 }));
  await assertFails(updateDoc(doc(sam, "budgets/own"), { userId: "group:g1" }));
});
