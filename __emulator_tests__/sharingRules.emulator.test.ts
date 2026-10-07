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
