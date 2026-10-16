/**
 * Privilege fields on users/{uid}: `systemRole` feeds isAdmin() and `familyId` feeds
 * inSameFamily(). A user must never be able to set or change them on their own doc
 * (they were writable: `isValidUserData` uses hasAll, and the update rule only guarded
 * role / groupIds / isActive). Loads the REAL firestore.rules.
 */
import * as fs from "fs";
import * as path from "path";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc, deleteDoc } from "firebase/firestore";

const preferences = {
  currency: "USD",
  locale: "en-US",
  theme: "auto",
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

const userDoc = (extra: Record<string, unknown> = {}) => ({
  email: "me@example.com", displayName: "Calm Otter", role: "viewer", isActive: true, preferences, ...extra,
});

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-users-privilege-fields",
    firestore: { rules: fs.readFileSync(process.env.RULES_PATH ?? path.join(__dirname, "..", "firestore.rules"), "utf8") },
  });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/alice"), userDoc());
    await setDoc(doc(db, "users/legacy-admin"), userDoc({ systemRole: "admin" }));
    await setDoc(doc(db, "users/bob"), userDoc());
    await setDoc(doc(db, "outflows/bob-bill"), { ownerId: "bob", userId: "bob", isActive: true });
    await setDoc(doc(db, "admin/settings"), { secret: true });
  });
});

describe("a user cannot grant themselves privilege fields", () => {
  it("cannot add systemRole:'admin' to their own profile", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(updateDoc(doc(db, "users/alice"), { systemRole: "admin" }));
    await assertFails(updateDoc(doc(db, "users/alice"), { systemRole: "power_user" }));
  });

  it("cannot add or change familyId on their own profile", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(updateDoc(doc(db, "users/alice"), { familyId: "bobs-family" }));
  });

  it("cannot create their profile with systemRole or familyId", async () => {
    const db = env.authenticatedContext("new-user").firestore();
    await assertFails(setDoc(doc(db, "users/new-user"), userDoc({ systemRole: "admin" })));
    await assertFails(setDoc(doc(db, "users/new-user"), userDoc({ familyId: "x" })));
    await assertSucceeds(setDoc(doc(db, "users/new-user"), userDoc())); // a normal profile still works
  });

  it("the escalation path is closed: no admin reads or deletes after trying", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(updateDoc(doc(db, "users/alice"), { systemRole: "admin" }));
    await assertFails(getDoc(doc(db, "admin/settings")));
    await assertFails(deleteDoc(doc(db, "outflows/bob-bill")));
    await assertFails(getDoc(doc(db, "users/bob")));
  });
});

describe("everything the app does still works", () => {
  it("profile edits the app makes", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertSucceeds(updateDoc(doc(db, "users/alice"), { displayName: "Bright Finch" }));
    await assertSucceeds(updateDoc(doc(db, "users/alice"), { "preferences.currency": "USD" }));
    await assertSucceeds(updateDoc(doc(db, "users/alice"), { homeLayout: { cards: [] }, updatedAt: new Date() }));
  });

  it("an existing systemRole is untouched by unrelated edits", async () => {
    const db = env.authenticatedContext("legacy-admin").firestore();
    await assertSucceeds(updateDoc(doc(db, "users/legacy-admin"), { displayName: "Still Admin" }));
  });

  it("an existing admin can still change privilege fields", async () => {
    const db = env.authenticatedContext("legacy-admin").firestore();
    await assertSucceeds(updateDoc(doc(db, "users/alice"), { familyId: "fam-1" }));
  });

  it("the old checks still hold", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(updateDoc(doc(db, "users/alice"), { role: "admin" }));
    await assertFails(updateDoc(doc(db, "users/alice"), { isActive: false }));
    await assertFails(updateDoc(doc(db, "users/alice"), { groupIds: ["g1"] }));
  });
});
