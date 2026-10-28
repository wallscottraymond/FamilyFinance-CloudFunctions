/**
 * Ideas (Planning-Module v1) — the callables end to end on the Firestore emulator.
 *
 * Proves, through the real entry points (`.run()`), that:
 *   - the flag gates every write; the capability call reports it;
 *   - only the title is required; a retried create (same id) writes nothing;
 *   - a Me idea is its person's only; a group idea is shared by every member (edit, like,
 *     comment) and invisible to anyone else (NOT_FOUND, never "not yours");
 *   - a new topic joins the list's topics; convert → restore round-trips; delete removes the
 *     idea and its comments; only a comment's author can delete it.
 *
 * Other suites share this emulator, so every assertion is scoped to ids this file created.
 *
 * Prereq: firebase emulators:exec --only firestore "npx jest --selectProjects emulator --testPathPattern ideas"
 */

import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();

import { create_idea } from "../src/functions/entry/callable/create_idea.entry";
import { update_idea } from "../src/functions/entry/callable/update_idea.entry";
import { delete_idea } from "../src/functions/entry/callable/delete_idea.entry";
import { react_to_idea } from "../src/functions/entry/callable/react_to_idea.entry";
import { get_ideas_capabilities } from "../src/functions/entry/callable/get_ideas_capabilities.entry";
import { set_feature_flag, invalidate_flag_cache } from "../src/functions/infrastructure/feature_flags";
import { IDEAS_FLAG } from "../src/functions/types/ideas.types";
import { manage_group_orchestrator } from "../src/functions/orchestrators/sharing/groups.orchestrator";

type Envelope = { success: boolean; data?: any; error?: { code: string; message: string }; trace_id: string };
type Runnable = { run: (r: unknown) => Promise<Envelope> };
const call = (fn: unknown, uid: string | null, data: unknown = {}): Promise<Envelope> =>
  (fn as Runnable).run(uid ? { auth: { uid, token: { uid } }, data } : { data });

const rnd = (): string => Math.random().toString(36).slice(2, 10);
const stamp = `${Date.now()}_${rnd()}`;
const uid = (p: string): string => `id_${p}_${stamp}`;
const new_id = (): string => `i_${Date.now()}_${rnd()}${rnd()}`;

const ALEX = uid("alex");
const SAM = uid("sam");
const MALLORY = uid("mallory");
const OFF_USER = uid("off");
const GID = `g_${stamp}`;
const GKEY = `group:${GID}`;

const created = { ideas: new Set<string>(), topics: new Set<string>() };

const add = async (who: string, over: Record<string, unknown> = {}): Promise<Envelope> => {
  const idea_id = (over.idea_id as string) ?? new_id();
  created.ideas.add(idea_id);
  created.topics.add(over.view_group_id ? `group:${over.view_group_id}` : who);
  return call(create_idea, who, { idea_id, title: "Ski trip", ...over });
};
const idea_doc = async (id: string) => (await db.collection("ideas").doc(id).get()).data();

beforeAll(async () => {
  await set_feature_flag(IDEAS_FLAG, { enabled: true, enabled_user_ids: [ALEX, SAM, MALLORY], rollout_percentage: 0 });
  invalidate_flag_cache();
  const now = admin.firestore.Timestamp.now();
  await db.collection("groups").doc(GID).set({
    name: "Household",
    ownerId: ALEX,
    members: { [ALEX]: { role: "owner", joinedAt: now }, [SAM]: { role: "full", joinedAt: now } },
    memberIds: [ALEX, SAM],
    createdAt: now,
    deletedAt: null,
    updatedAt: now,
  });
});

afterAll(async () => {
  const writer = db.bulkWriter();
  for (const id of created.ideas) {
    writer.delete(db.collection("ideas").doc(id));
    const comments = await db.collection("idea_comments").where("ideaId", "==", id).get();
    comments.docs.forEach((d) => writer.delete(d.ref));
  }
  for (const key of created.topics) writer.delete(db.collection("idea_topics").doc(key));
  writer.delete(db.collection("groups").doc(GID));
  await writer.close();
});

describe("flag", () => {
  it("capabilities report it; writes are refused when it's off", async () => {
    expect((await call(get_ideas_capabilities, ALEX)).data).toEqual({ enabled: true });
    expect((await call(get_ideas_capabilities, OFF_USER)).data).toEqual({ enabled: false });
    const res = await add(OFF_USER);
    expect(res.error?.code).toBe("FEATURE_DISABLED");
  });

  it("refuses an unauthenticated call", async () => {
    await expect(call(create_idea, null, { idea_id: new_id(), title: "x" })).rejects.toThrow(/authenticated/);
  });
});

describe("create_idea", () => {
  it("only the title is required; the rest is stored empty", async () => {
    const res = await add(ALEX, { title: "  Standing desk " });
    expect(res.success).toBe(true);
    const d = await idea_doc(res.data.idea_id);
    expect(d).toMatchObject({
      userId: ALEX, createdBy: ALEX, title: "Standing desk", notes: "", kind: "idea", topic: null,
      amount: null, date: null, likedBy: [], commentCount: 0, status: "open", expireAt: null,
    });
  });

  it("a retried create writes nothing new", async () => {
    const idea_id = new_id();
    const first = await add(ALEX, { idea_id, title: "Tires" });
    const again = await add(ALEX, { idea_id, title: "Different" });
    expect(first.data.deduped).toBe(false);
    expect(again.data).toEqual({ idea_id, deduped: true });
    expect((await idea_doc(idea_id))?.title).toBe("Tires");
  });

  it("refuses bad input", async () => {
    expect((await add(ALEX, { title: "   " })).error?.code).toBe("VALIDATION_ERROR");
    expect((await add(ALEX, { date: "2026-02-30" })).error?.code).toBe("VALIDATION_ERROR");
    expect((await call(create_idea, ALEX, { idea_id: "short", title: "x" })).error?.code).toBe("VALIDATION_ERROR");
  });

  it("a group list: members only; a new topic joins the list's topics", async () => {
    const res = await add(SAM, { view_group_id: GID, title: "Maya's party", kind: "budget", topic: "Kids", amount: 250, date: "2026-11-22" });
    expect(res.success).toBe(true);
    expect(await idea_doc(res.data.idea_id)).toMatchObject({ userId: GKEY, createdBy: SAM, topic: "Kids", amount: 250 });
    expect((await db.collection("idea_topics").doc(GKEY).get()).data()).toMatchObject({ topics: ["Kids"], counts: { Kids: 1 } });
    // Same topic, other case: reused as spelled.
    const again = await add(ALEX, { view_group_id: GID, title: "Cake", topic: "kids" });
    expect((await idea_doc(again.data.idea_id))?.topic).toBe("Kids");

    expect((await add(MALLORY, { view_group_id: GID })).error?.code).toBe("PERMISSION_DENIED");
  });
});

describe("sharing", () => {
  it("any member edits a group idea; an outsider gets NOT_FOUND", async () => {
    const { data } = await add(ALEX, { view_group_id: GID, title: "Thanksgiving" });
    const edit = await call(update_idea, SAM, { action: "edit", idea_id: data.idea_id, fields: { amount: 300, notes: "• Turkey\n• Pies" } });
    expect(edit.success).toBe(true);
    expect(await idea_doc(data.idea_id)).toMatchObject({ amount: 300, notes: "• Turkey\n• Pies", updatedBy: SAM });

    const outsider = await call(update_idea, MALLORY, { action: "edit", idea_id: data.idea_id, fields: { amount: 1 } });
    expect(outsider.error?.code).toBe("NOT_FOUND");
  });

  it("a Me idea is invisible to group members", async () => {
    const { data } = await add(ALEX, { title: "Private" });
    expect((await call(update_idea, SAM, { action: "edit", idea_id: data.idea_id, fields: { title: "x" } })).error?.code).toBe("NOT_FOUND");
    expect((await call(react_to_idea, SAM, { action: "like", idea_id: data.idea_id, liked: true })).error?.code).toBe("NOT_FOUND");
  });
});

describe("convert / restore / delete", () => {
  it("convert takes it off the open list with an expiry; restore puts it back", async () => {
    const { data } = await add(ALEX, { title: "Gifts" });
    const conv = await call(update_idea, ALEX, { action: "convert", idea_id: data.idea_id, converted_to: { kind: "budget", id: "b_123" } });
    expect(conv.data).toEqual({ idea_id: data.idea_id, status: "converted" });
    const d = await idea_doc(data.idea_id);
    expect(d).toMatchObject({ status: "converted", convertedTo: { kind: "budget", id: "b_123" } });
    expect(d?.expireAt).toBeTruthy();
    expect((await call(update_idea, ALEX, { action: "edit", idea_id: data.idea_id, fields: { title: "x" } })).error?.code).toBe("FAILED_PRECONDITION");

    await call(update_idea, ALEX, { action: "restore", idea_id: data.idea_id });
    expect(await idea_doc(data.idea_id)).toMatchObject({ status: "open", convertedTo: null, expireAt: null });
  });

  it("delete removes the idea and its comments; deleting again succeeds", async () => {
    const { data } = await add(ALEX, { view_group_id: GID, title: "Repaint" });
    const comment_id = new_id();
    await call(react_to_idea, SAM, { action: "comment", idea_id: data.idea_id, comment_id, text: "Blue?" });
    expect((await db.collection("idea_comments").doc(comment_id).get()).exists).toBe(true);

    expect((await call(delete_idea, SAM, { idea_id: data.idea_id })).data).toEqual({ idea_id: data.idea_id, deleted: true });
    expect(await idea_doc(data.idea_id)).toBeUndefined();
    expect((await db.collection("idea_comments").doc(comment_id).get()).exists).toBe(false);
    expect((await call(delete_idea, SAM, { idea_id: data.idea_id })).data.deleted).toBe(false);
  });
});

describe("react_to_idea", () => {
  it("likes, comments (retry-safe), and only the author deletes a comment", async () => {
    const { data } = await add(ALEX, { view_group_id: GID, title: "Ski trip" });
    const id = data.idea_id;

    await call(react_to_idea, SAM, { action: "like", idea_id: id, liked: true });
    await call(react_to_idea, ALEX, { action: "like", idea_id: id, liked: true });
    await call(react_to_idea, SAM, { action: "like", idea_id: id, liked: true });
    expect((await idea_doc(id))?.likedBy).toEqual([SAM, ALEX]);
    await call(react_to_idea, SAM, { action: "like", idea_id: id, liked: false });
    expect((await idea_doc(id))?.likedBy).toEqual([ALEX]);

    const comment_id = new_id();
    const first = await call(react_to_idea, SAM, { action: "comment", idea_id: id, comment_id, text: " Park is cheaper " });
    const retry = await call(react_to_idea, SAM, { action: "comment", idea_id: id, comment_id, text: " Park is cheaper " });
    expect(first.data.comment_count).toBe(1);
    expect(retry.data.comment_count).toBe(1);
    expect((await db.collection("idea_comments").doc(comment_id).get()).data()).toMatchObject({
      ideaId: id, userId: GKEY, authorId: SAM, text: "Park is cheaper",
    });

    expect((await call(react_to_idea, ALEX, { action: "delete_comment", idea_id: id, comment_id })).error?.code).toBe("PERMISSION_DENIED");
    const del = await call(react_to_idea, SAM, { action: "delete_comment", idea_id: id, comment_id });
    expect(del.data.comment_count).toBe(0);
    expect((await db.collection("idea_comments").doc(comment_id).get()).exists).toBe(false);
  });
});

describe("topics follow the open ideas", () => {
  it("a topic drops out when no open idea uses it, and comes back on restore", async () => {
    const { data } = await add(ALEX, { title: "Garden beds", topic: "Garden" });
    const topics = async () => (await db.collection("idea_topics").doc(ALEX).get()).data();
    expect((await topics())?.topics).toContain("Garden");

    await call(update_idea, ALEX, { action: "convert", idea_id: data.idea_id, converted_to: { kind: "goal", id: "g_1" } });
    expect((await topics())?.topics ?? []).not.toContain("Garden");

    await call(update_idea, ALEX, { action: "restore", idea_id: data.idea_id });
    expect((await topics())?.topics).toContain("Garden");
    expect((await topics())?.counts?.Garden).toBe(1);

    await call(update_idea, ALEX, { action: "edit", idea_id: data.idea_id, fields: { topic: null } });
    expect((await topics())?.topics ?? []).not.toContain("Garden");
  });
});

describe("comments follow the idea", () => {
  it("converting stamps the comments' expiry; restoring clears it", async () => {
    const { data } = await add(ALEX, { view_group_id: GID, title: "Bikes" });
    const comment_id = new_id();
    await call(react_to_idea, SAM, { action: "comment", idea_id: data.idea_id, comment_id, text: "Used ones?" });
    const expiry = async () => (await db.collection("idea_comments").doc(comment_id).get()).data()?.expireAt;
    expect(await expiry()).toBeNull();

    await call(update_idea, SAM, { action: "convert", idea_id: data.idea_id, converted_to: { kind: "goal", id: "g_2" } });
    expect(await expiry()).toBeTruthy();
    await call(update_idea, SAM, { action: "restore", idea_id: data.idea_id });
    expect(await expiry()).toBeNull();
  });
});

describe("a closed group's ideas go with it", () => {
  it("deleting the group deletes its ideas, comments and topics", async () => {
    const gid = `gc_${stamp}`;
    const now = admin.firestore.Timestamp.now();
    await db.collection("groups").doc(gid).set({
      name: "Closing", ownerId: ALEX,
      members: { [ALEX]: { role: "owner", joinedAt: now }, [SAM]: { role: "full", joinedAt: now } },
      memberIds: [ALEX, SAM], createdAt: now, deletedAt: null, updatedAt: now,
    });
    const { data } = await add(ALEX, { view_group_id: gid, title: "Cabin", topic: "Trip" });
    const comment_id = new_id();
    await call(react_to_idea, SAM, { action: "comment", idea_id: data.idea_id, comment_id, text: "Yes!" });

    const res = await manage_group_orchestrator({
      trace_id: "t", span_id: "s", user_id: ALEX, idempotency_key: "k", input: { action: "delete", group_id: gid },
    } as never);
    expect(res.success).toBe(true);
    expect(await idea_doc(data.idea_id)).toBeUndefined();
    expect((await db.collection("idea_comments").doc(comment_id).get()).exists).toBe(false);
    expect((await db.collection("idea_topics").doc(`group:${gid}`).get()).exists).toBe(false);
    await db.collection("groups").doc(gid).delete();
  });
});
