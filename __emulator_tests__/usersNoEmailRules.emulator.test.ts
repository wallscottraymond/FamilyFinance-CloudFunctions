/**
 * Sign-In-With-Apple: accounts with NO email (Sign in with Apple requesting no scopes, anonymous)
 * store `email: ""`. The users-doc update rule (`isValidUserData`) used to require
 * `email.size() > 0`, rejecting EVERY profile update for them. Loads the REAL firestore.rules.
 */
import * as fs from "fs";
import * as path from "path";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";

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

const userDoc = (email: string) => ({
  email, displayName: "Calm Otter", role: "parent", isActive: true, preferences,
});

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-users-no-email",
    firestore: { rules: fs.readFileSync(process.env.RULES_PATH ?? path.join(__dirname, "..", "firestore.rules"), "utf8") },
  });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users/apple-user"), userDoc(""));
    await setDoc(doc(ctx.firestore(), "users/email-user"), userDoc("me@example.com"));
  });
});

it("a no-email (Apple / anonymous) user CAN update their profile", async () => {
  const db = env.authenticatedContext("apple-user").firestore();
  await assertSucceeds(updateDoc(doc(db, "users/apple-user"), { displayName: "Bright Finch" }));
  await assertSucceeds(
    updateDoc(doc(db, "users/apple-user"), { "preferences.display.periodView.defaultPeriodType": "weekly" })
  );
});

it("email users still can, and the other checks still hold", async () => {
  const db = env.authenticatedContext("email-user").firestore();
  await assertSucceeds(updateDoc(doc(db, "users/email-user"), { displayName: "Me" }));
  await assertFails(updateDoc(doc(db, "users/email-user"), { role: "admin" })); // can't promote self
  await assertFails(updateDoc(doc(db, "users/email-user"), { email: 42 })); // must stay a string
  await assertFails(updateDoc(doc(db, "users/email-user"), { displayName: "" })); // name still required
});

it("another user can't edit someone's profile", async () => {
  const db = env.authenticatedContext("email-user").firestore();
  await assertFails(updateDoc(doc(db, "users/apple-user"), { displayName: "Hijack" }));
});
