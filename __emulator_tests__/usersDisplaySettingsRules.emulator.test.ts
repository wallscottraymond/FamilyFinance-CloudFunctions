/**
 * Display Settings on users/{uid}: the owner can change ONLY `preferences.theme`
 * ('light' | 'dark' | 'auto') and `preferences.colorThemeId`, even when the stored legacy
 * `preferences` would fail the full-profile check (real profiles do: every other preference write
 * is denied for them). The fast path must not widen anything else. Loads the REAL firestore.rules.
 */
import * as fs from "fs";
import * as path from "path";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

// A legacy-shaped profile: `notifications` lacks keys the full check now requires, so a normal
// profile update is denied (as for the real users).
const legacyPreferences = {
  currency: "USD",
  locale: "en-US",
  theme: "auto",
  notifications: { email: true },
  privacy: {},
  display: {},
  accessibility: {},
  financial: { budgetRolloverEnabled: false },
  security: {},
};
const userDoc = { email: "me@example.com", displayName: "Calm Otter", role: "viewer", isActive: true, preferences: legacyPreferences };
const UID = "displayUser";
const OTHER = "otherUser";

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-users-display-settings",
    firestore: { rules: fs.readFileSync(process.env.RULES_PATH ?? path.join(__dirname, "..", "firestore.rules"), "utf8") },
  });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", UID), userDoc);
    await setDoc(doc(ctx.firestore(), "users", OTHER), { ...userDoc, email: "other@example.com" });
  });
});

const write = (as: string, target: string, data: Record<string, unknown>) =>
  updateDoc(doc(env.authenticatedContext(as).firestore(), "users", target), { ...data, updatedAt: serverTimestamp() });
const prefs = (patch: Record<string, unknown>) => ({ preferences: { ...legacyPreferences, ...patch } });

describe("Display Settings preference writes", () => {
  it.each(["dark", "light", "auto"])("owner saves preferences.theme=%s on a legacy profile", async (theme) => {
    await assertSucceeds(write(UID, UID, prefs({ theme })));
  });

  it("owner saves via the app's field-path write (userService.updateAppearancePreference)", async () => {
    await assertSucceeds(write(UID, UID, { "preferences.theme": "dark" }));
  });

  it("owner saves a color theme id with it", async () => {
    await assertSucceeds(write(UID, UID, prefs({ theme: "dark", colorThemeId: "budg" })));
  });

  it("CONTROL: any other preference change on the legacy profile is still denied", async () => {
    await assertFails(write(UID, UID, prefs({ currency: "EUR" })));
  });

  it("an invalid theme value is denied", async () => {
    await assertFails(write(UID, UID, prefs({ theme: "sepia" })));
  });

  it("a non-string or oversized colorThemeId is denied", async () => {
    await assertFails(write(UID, UID, prefs({ colorThemeId: 7 })));
    await assertFails(write(UID, UID, prefs({ colorThemeId: "x".repeat(41) })));
  });

  it("theme + another preference in one write is denied (no widening)", async () => {
    await assertFails(write(UID, UID, prefs({ theme: "dark", financial: { budgetRolloverEnabled: true } })));
  });

  it("theme + a top-level field (role) in one write is denied", async () => {
    await assertFails(write(UID, UID, { ...prefs({ theme: "dark" }), role: "admin" }));
  });

  it("another user can't change someone else's theme", async () => {
    await assertFails(write(OTHER, UID, prefs({ theme: "dark" })));
  });
});
