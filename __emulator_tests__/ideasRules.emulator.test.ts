/**
 * Rules — Ideas (Planning-Module v1; loads the REAL firestore.rules).
 *
 * A Me list (userId = uid) is its person's only. A group list (userId = "group:<id>") is readable
 * by every member of that group and nobody else. No client writes any of the three collections
 * (every write goes through the callables, which enforce the bounds).
 */
import * as fs from "fs";
import * as path from "path";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, deleteDoc, where } from "firebase/firestore";

let env: RulesTestEnvironment;
const RULES = fs.readFileSync(process.env.RULES_PATH ?? path.join(__dirname, "..", "firestore.rules"), "utf8");

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-ideas-rules", firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "groups/g1"), { name: "Household", ownerId: "alex", memberIds: ["alex", "sam"] });
    await setDoc(doc(db, "ideas/g_idea"), { userId: "group:g1", createdBy: "alex", title: "Trip", status: "open" });
    await setDoc(doc(db, "ideas/me_idea"), { userId: "alex", createdBy: "alex", title: "Desk", status: "open" });
    await setDoc(doc(db, "ideas/fake"), { userId: "group:nope", createdBy: "mallory", title: "X", status: "open" });
    await setDoc(doc(db, "idea_comments/c1"), { userId: "group:g1", ideaId: "g_idea", authorId: "sam", text: "yes" });
    await setDoc(doc(db, "idea_topics/group:g1"), { userId: "group:g1", topics: ["Trip"] });
    await setDoc(doc(db, "idea_topics/alex"), { userId: "alex", topics: ["Home"] });
  });
});

describe("ideas", () => {
  it("group members read the group's ideas; others can't", async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext("sam").firestore(), "ideas/g_idea")));
    await assertSucceeds(getDoc(doc(env.authenticatedContext("alex").firestore(), "ideas/g_idea")));
    await assertFails(getDoc(doc(env.authenticatedContext("mallory").firestore(), "ideas/g_idea")));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "ideas/g_idea")));
  });

  it("a Me idea is its person's only (membership doesn't leak it)", async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext("alex").firestore(), "ideas/me_idea")));
    await assertFails(getDoc(doc(env.authenticatedContext("sam").firestore(), "ideas/me_idea")));
    await assertFails(getDoc(doc(env.authenticatedContext("sam").firestore(), "ideas/fake")));
  });

  it("the list queries the app runs are allowed; an unscoped one isn't", async () => {
    const sam = env.authenticatedContext("sam").firestore();
    await assertSucceeds(getDocs(query(collection(sam, "ideas"), where("userId", "==", "group:g1"), where("status", "==", "open"))));
    await assertSucceeds(getDocs(query(collection(sam, "ideas"), where("userId", "==", "sam"), where("status", "==", "open"))));
    await assertFails(getDocs(query(collection(sam, "ideas"), where("userId", "==", "alex"))));
    await assertFails(getDocs(collection(sam, "ideas")));
  });

  it("no client writes", async () => {
    const alex = env.authenticatedContext("alex").firestore();
    await assertFails(setDoc(doc(alex, "ideas/new"), { userId: "alex", title: "x" }));
    await assertFails(updateDoc(doc(alex, "ideas/me_idea"), { title: "y" }));
    await assertFails(deleteDoc(doc(alex, "ideas/g_idea")));
  });
});

describe("idea_comments", () => {
  it("members read a group idea's comments (by query too); others and writes can't", async () => {
    const sam = env.authenticatedContext("sam").firestore();
    await assertSucceeds(getDoc(doc(sam, "idea_comments/c1")));
    await assertSucceeds(getDocs(query(collection(sam, "idea_comments"), where("ideaId", "==", "g_idea"), where("userId", "==", "group:g1"))));
    await assertFails(getDoc(doc(env.authenticatedContext("mallory").firestore(), "idea_comments/c1")));
    await assertFails(setDoc(doc(sam, "idea_comments/c2"), { userId: "group:g1", ideaId: "g_idea", authorId: "sam", text: "x" }));
    await assertFails(deleteDoc(doc(sam, "idea_comments/c1")));
  });
});

describe("idea_topics", () => {
  it("readable by the list's people, even before the doc exists; never writable", async () => {
    const sam = env.authenticatedContext("sam").firestore();
    await assertSucceeds(getDoc(doc(sam, "idea_topics/group:g1")));
    await assertSucceeds(getDoc(doc(sam, "idea_topics/sam")));
    await assertFails(getDoc(doc(sam, "idea_topics/alex")));
    await assertFails(getDoc(doc(env.authenticatedContext("mallory").firestore(), "idea_topics/group:g1")));
    await assertFails(setDoc(doc(sam, "idea_topics/sam"), { userId: "sam", topics: ["x"] }));
  });
});
