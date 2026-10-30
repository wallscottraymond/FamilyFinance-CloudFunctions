/**
 * users/{uid} rules: Budget Settings saves + who counts as admin (Code-Health-Review batch 2).
 *
 * S1-M2 / S3-M1 / M8-M2: every real profile (role 'editor', legacy `preferences` shape) fails the
 * strict full-profile check, so Budget Settings (the app's only preferences write besides
 * Display Settings) was denied. The owner may now change ONLY the three rollover defaults under
 * `preferences.financial`, with valid values, and nothing else.
 *
 * S1-M1 / S2-L1–L3: `isAdmin()` trusted the legacy custom claim `role == 'admin'` (written by the
 * retired group endpoints and `makeUserAdmin`). Admin is now ONLY the server-written
 * `users/{uid}.systemRole == 'admin'`. Loads the REAL firestore.rules.
 */
import * as fs from "fs";
import * as path from "path";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

// A real-shaped profile: role 'editor' (what onUserCreate writes) and a legacy `preferences` map
// that fails the strict full-profile check.
const legacyPreferences = {
  currency: "USD",
  locale: "en-US",
  theme: "auto",
  notifications: { email: true },
  privacy: {},
  display: {},
  accessibility: {},
  financial: {
    budgetRolloverEnabled: true,
    budgetRolloverStrategy: "spread",
    budgetRolloverSpreadPeriods: 3,
    hiddenAccounts: [],
    showNetWorth: true,
  },
  security: {},
};
const userDoc = {
  email: "me@example.com", displayName: "Calm Otter", role: "editor", isActive: true,
  preferences: legacyPreferences,
};
const UID = "budgetSettingsUser";
const OTHER = "otherUser";
const SYS_ADMIN = "systemAdmin";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-users-budget-settings",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8") },
  });
});
afterAll(async () => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", UID), userDoc);
    await setDoc(doc(db, "users", OTHER), { ...userDoc, email: "other@example.com" });
    await setDoc(doc(db, "users", SYS_ADMIN), { ...userDoc, email: "admin@example.com", systemRole: "admin" });
    await setDoc(doc(db, "transactions", "t_other"), { userId: OTHER, ownerId: OTHER, groupIds: [], amount: 5 });
  });
});

const db = (uid: string, claims?: Record<string, unknown>) =>
  env.authenticatedContext(uid, claims).firestore();
const write = (as: string, target: string, data: Record<string, unknown>) =>
  updateDoc(doc(db(as), "users", target), { ...data, updatedAt: serverTimestamp() });
/** Exactly what userService.updateUserPreferences sends: the WHOLE merged preferences map. */
const financial = (patch: Record<string, unknown>) => ({
  preferences: { ...legacyPreferences, financial: { ...legacyPreferences.financial, ...patch } },
});

describe("Budget Settings (rollover defaults) on a real profile", () => {
  it("owner saves all three rollover defaults (the app's whole-map write)", async () => {
    await assertSucceeds(write(UID, UID, financial({
      budgetRolloverEnabled: false, budgetRolloverStrategy: "immediate", budgetRolloverSpreadPeriods: 6,
    })));
  });

  it.each([
    ["enabled only", { budgetRolloverEnabled: false }],
    ["strategy only", { budgetRolloverStrategy: "immediate" }],
    ["spread only", { budgetRolloverSpreadPeriods: 1 }],
  ])("owner saves %s", async (_label, patch) => {
    await assertSucceeds(write(UID, UID, financial(patch)));
  });

  it("owner saves via a field-path write", async () => {
    await assertSucceeds(write(UID, UID, { "preferences.financial.budgetRolloverEnabled": false }));
  });

  it("owner saves rollover defaults onto a profile that has no financial section yet", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const prefs: Record<string, unknown> = { ...legacyPreferences };
      delete prefs.financial;
      await setDoc(doc(ctx.firestore(), "users", UID), { ...userDoc, preferences: prefs });
    });
    await assertSucceeds(write(UID, UID, { "preferences.financial": {
      budgetRolloverEnabled: true, budgetRolloverStrategy: "spread", budgetRolloverSpreadPeriods: 3,
    } }));
  });

  it.each([
    ["enabled not a bool", { budgetRolloverEnabled: "yes" }],
    ["unknown strategy", { budgetRolloverStrategy: "bogus" }],
    ["spread 0", { budgetRolloverSpreadPeriods: 0 }],
    ["spread 7", { budgetRolloverSpreadPeriods: 7 }],
    ["spread not an int", { budgetRolloverSpreadPeriods: 2.5 }],
  ])("rejects an invalid value: %s", async (_label, patch) => {
    await assertFails(write(UID, UID, financial(patch)));
  });

  it("CONTROL: other financial keys stay locked (e.g. hiddenAccounts)", async () => {
    await assertFails(write(UID, UID, financial({ hiddenAccounts: ["acct_1"] })));
  });

  it("CONTROL: other preference sections stay locked on the legacy profile", async () => {
    await assertFails(write(UID, UID, {
      preferences: { ...legacyPreferences, currency: "EUR" },
    }));
  });

  it.each([
    ["role", { role: "admin" }],
    ["systemRole", { systemRole: "admin" }],
    ["groupIds", { groupIds: ["g1"] }],
    ["isActive", { isActive: false }],
  ])("CONTROL: can't change %s alongside a rollover save", async (_label, extra) => {
    await assertFails(write(UID, UID, { ...financial({ budgetRolloverEnabled: false }), ...extra }));
  });

  it("CONTROL: another user can't change my rollover defaults", async () => {
    await assertFails(write(OTHER, UID, financial({ budgetRolloverEnabled: false })));
  });

  it("CONTROL: Display Settings fast path still works", async () => {
    await assertSucceeds(write(UID, UID, { "preferences.theme": "dark" }));
  });
});

describe("who counts as admin", () => {
  it("a legacy custom claim role=admin no longer grants admin reads", async () => {
    await assertFails(getDoc(doc(db(UID, { role: "admin" }), "users", OTHER)));
    await assertFails(getDoc(doc(db(UID, { role: "admin" }), "transactions", "t_other")));
  });

  it("a legacy custom claim role=admin can't write someone else's profile", async () => {
    await assertFails(updateDoc(doc(db(UID, { role: "admin" }), "users", OTHER), { displayName: "Hacked" }));
  });

  it("a server-written systemRole=admin still has admin reads", async () => {
    await assertSucceeds(getDoc(doc(db(SYS_ADMIN), "users", OTHER)));
  });

  it("CONTROL: users still read their own profile", async () => {
    await assertSucceeds(getDoc(doc(db(UID), "users", UID)));
  });
});
