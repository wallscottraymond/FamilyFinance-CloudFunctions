/**
 * Rules — Bills-to-review items + review state (Convert-To-Recurring D15 / G2, test plan "Rules").
 * Loads the REAL firestore.rules.
 *
 *   - `recurring_review_items`: the owner reads their own items (get + the app's one listener,
 *     `userId == uid`); a group member / anyone else is denied, including a legacy family member
 *     and a legacy admin (no isAdmin / familyId branches); a list query WITHOUT the owner
 *     predicate is denied; nobody writes from the client.
 *   - `_recurring_review_state`, `_recurring_detector_state`: deny-all.
 *   - The users privilege-field fix (9a73e01) still holds.
 */
import * as fs from "fs";
import * as path from "path";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, deleteDoc, where } from "firebase/firestore";

let env: RulesTestEnvironment;
const RULES = fs.readFileSync(process.env.RULES_PATH ?? path.join(__dirname, "..", "firestore.rules"), "utf8");

const item = (userId: string, extra: Record<string, unknown> = {}) => ({
  id: `${userId}__suggested__abc`, userId, kind: "suggested", status: "open", direction: "outflow",
  name: "Avant", amount: 98, accountId: "acct_shared", ...extra,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-review-items-rules", firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/owner"), { email: "o@x.com", familyId: "fam1", groupIds: ["g1"] });
    await setDoc(doc(db, "users/member"), { email: "m@x.com", familyId: "fam1", groupIds: ["g1"] });
    await setDoc(doc(db, "users/old-admin"), { email: "a@x.com", systemRole: "admin" });
    await setDoc(doc(db, "groups/g1"), { ownerId: "owner", memberIds: ["owner", "member"], members: [] });
    await setDoc(doc(db, "recurring_review_items/owner__suggested__abc"), item("owner", { familyId: "fam1", groupIds: ["g1"] }));
    await setDoc(doc(db, "recurring_review_items/member__suggested__abc"), item("member"));
    await setDoc(doc(db, "_recurring_review_state/owner"), { suppressedTxnIds: ["p1"], dismissedVendorKeys: [] });
    await setDoc(doc(db, "_recurring_detector_state/owner"), { lastRunDay: "2026-10-15" });
  });
});

describe("recurring_review_items", () => {
  it("the owner reads their own item and lists their open items", async () => {
    const db = env.authenticatedContext("owner").firestore();
    await assertSucceeds(getDoc(doc(db, "recurring_review_items/owner__suggested__abc")));
    await assertSucceeds(getDocs(query(collection(db, "recurring_review_items"),
      where("userId", "==", "owner"), where("status", "==", "open"))));
  });

  it("G2: a group member (same group, same legacy family) cannot read the owner's item", async () => {
    const db = env.authenticatedContext("member").firestore();
    await assertFails(getDoc(doc(db, "recurring_review_items/owner__suggested__abc")));
    await assertFails(getDocs(query(collection(db, "recurring_review_items"), where("userId", "==", "owner"))));
    await assertSucceeds(getDoc(doc(db, "recurring_review_items/member__suggested__abc"))); // their own
  });

  it("a list query without `userId == uid` is denied", async () => {
    const db = env.authenticatedContext("owner").firestore();
    await assertFails(getDocs(collection(db, "recurring_review_items")));
    await assertFails(getDocs(query(collection(db, "recurring_review_items"), where("status", "==", "open"))));
    await assertFails(getDocs(query(collection(db, "recurring_review_items"), where("accountId", "==", "acct_shared"))));
  });

  it("no isAdmin / familyId branches: a legacy admin and the unauthenticated are denied", async () => {
    await assertFails(getDoc(doc(env.authenticatedContext("old-admin").firestore(), "recurring_review_items/owner__suggested__abc")));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "recurring_review_items/owner__suggested__abc")));
    const block = RULES.slice(RULES.indexOf("match /recurring_review_items/{itemId}"));
    const body = block.slice(0, block.indexOf("\n    }") + 6);
    expect(body).toContain("allow read: if request.auth != null && resource.data.userId == request.auth.uid;");
    expect(body).toContain("allow write: if false;");
    expect(body).not.toMatch(/isAdmin|familyId|inSameFamily|canAccessGroup|groupIds/);
  });

  it("nobody writes items from the client (create, update, delete)", async () => {
    const db = env.authenticatedContext("owner").firestore();
    await assertFails(setDoc(doc(db, "recurring_review_items/owner__suggested__new"), item("owner")));
    await assertFails(updateDoc(doc(db, "recurring_review_items/owner__suggested__abc"), { status: "dismissed" }));
    await assertFails(deleteDoc(doc(db, "recurring_review_items/owner__suggested__abc")));
  });
});

describe("server-only review state", () => {
  it("_recurring_review_state and _recurring_detector_state are deny-all, even for the owner", async () => {
    const db = env.authenticatedContext("owner").firestore();
    await assertFails(getDoc(doc(db, "_recurring_review_state/owner")));
    await assertFails(setDoc(doc(db, "_recurring_review_state/owner"), { suppressedTxnIds: [] }));
    await assertFails(getDoc(doc(db, "_recurring_detector_state/owner")));
    await assertFails(setDoc(doc(db, "_recurring_detector_state/owner"), { lastRunDay: null }));
  });
});

describe("9a73e01 users privilege-field fix still holds", () => {
  it("a user still cannot grant themselves systemRole / familyId", async () => {
    const db = env.authenticatedContext("owner").firestore();
    await assertFails(updateDoc(doc(db, "users/owner"), { systemRole: "admin" }));
    await assertFails(updateDoc(doc(db, "users/owner"), { familyId: "other" }));
  });
});
