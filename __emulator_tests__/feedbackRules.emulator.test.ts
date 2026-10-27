/**
 * Rules — Feedback-And-Questions (loads the REAL firestore.rules).
 *
 * `feedback` and `feedback_senders` are functions-only: no client may read a note (not even the
 * sender — notes don't say who sent them), list the inbox, read their own sender doc, or write
 * either collection (a client-side write would bypass the daily limit and the no-sender rule).
 */
import * as fs from "fs";
import * as path from "path";
import {
  initializeTestEnvironment,
  assertFails,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

let env: RulesTestEnvironment;
const RULES = fs.readFileSync(process.env.RULES_PATH ?? path.join(__dirname, "..", "firestore.rules"), "utf8");

const NOTE = {
  type: "idea", message: "hello", appVersion: "1.0", build: "52", screen: null, device: null,
  osVersion: null, status: "open", readByOwner: false, reply: null,
};

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-feedback-rules", firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/alex"), { email: "a@x.com", systemRole: "admin" });
    await setDoc(doc(db, "feedback/note_aaaaaaaaaaaaaaaa"), NOTE);
    await setDoc(doc(db, "feedback_senders/alex"), { noteIds: ["note_aaaaaaaaaaaaaaaa"], dailyCount: 1, dailyDate: "2026-10-25" });
  });
});

describe("feedback (notes)", () => {
  it("nobody reads a note — signed out, the sender, or an admin-role user", async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "feedback/note_aaaaaaaaaaaaaaaa")));
    await assertFails(getDoc(doc(env.authenticatedContext("alex").firestore(), "feedback/note_aaaaaaaaaaaaaaaa")));
    await assertFails(getDoc(doc(env.authenticatedContext("bob").firestore(), "feedback/note_aaaaaaaaaaaaaaaa")));
  });

  it("nobody lists the inbox", async () => {
    await assertFails(getDocs(collection(env.authenticatedContext("alex").firestore(), "feedback")));
    await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), "feedback")));
  });

  it("nobody creates, edits or deletes a note from the client", async () => {
    const db = env.authenticatedContext("alex").firestore();
    await assertFails(setDoc(doc(db, "feedback/note_bbbbbbbbbbbbbbbb"), NOTE));
    await assertFails(updateDoc(doc(db, "feedback/note_aaaaaaaaaaaaaaaa"), { status: "done" }));
    await assertFails(deleteDoc(doc(db, "feedback/note_aaaaaaaaaaaaaaaa")));
  });
});

describe("feedback_senders", () => {
  it("a user can't read even their OWN sender doc, or anyone else's", async () => {
    await assertFails(getDoc(doc(env.authenticatedContext("alex").firestore(), "feedback_senders/alex")));
    await assertFails(getDoc(doc(env.authenticatedContext("bob").firestore(), "feedback_senders/alex")));
    await assertFails(getDocs(collection(env.authenticatedContext("alex").firestore(), "feedback_senders")));
  });

  it("a user can't reset their daily counter or rewrite their list", async () => {
    const db = env.authenticatedContext("alex").firestore();
    await assertFails(updateDoc(doc(db, "feedback_senders/alex"), { dailyCount: 0 }));
    await assertFails(setDoc(doc(db, "feedback_senders/alex"), { noteIds: [], dailyCount: 0, dailyDate: "" }));
    await assertFails(deleteDoc(doc(db, "feedback_senders/alex")));
    await assertFails(setDoc(doc(db, "feedback_senders/bob"), { noteIds: [], dailyCount: 0, dailyDate: "" }));
  });
});
