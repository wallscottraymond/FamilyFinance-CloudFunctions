/**
 * Feedback-And-Questions — the four callables end to end on the Firestore emulator.
 *
 * Proves, through the real entry points (`.run()`), that:
 *   - a stored note carries NO sender (no uid / email / name in any field name or value);
 *   - a retried send (same note id) writes nothing new; another user can't reuse a taken id;
 *   - the 20-per-UTC-day limit holds, including under 25 concurrent sends, and resets next day;
 *   - the Sent tab shows only the caller's own notes, newest first, without inbox state;
 *   - the inbox is owner-only (allowlist ONLY — rollout 100 doesn't open it), and its list / mark
 *     read / open-done / delete behave, with delete also cleaning the sender's list.
 *
 * Other suites share this emulator, so every assertion is scoped to ids this file created.
 *
 * Prereq: firebase emulators:exec --only firestore "npx jest --selectProjects emulator --testPathPattern feedback"
 */

import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();

import { submit_feedback } from "../src/functions/entry/callable/submit_feedback.entry";
import { list_my_feedback } from "../src/functions/entry/callable/list_my_feedback.entry";
import { get_feedback_status } from "../src/functions/entry/callable/get_feedback_status.entry";
import { manage_feedback_inbox } from "../src/functions/entry/callable/manage_feedback_inbox.entry";
import { submit_feedback_orchestrator } from "../src/functions/orchestrators/feedback/feedback.orchestrator";
import { set_feature_flag, invalidate_flag_cache } from "../src/functions/infrastructure/feature_flags";
import { FEEDBACK_INBOX_FLAG, MAX_FEEDBACK_PER_DAY } from "../src/functions/types/feedback.types";

type Envelope = { success: boolean; data?: any; error?: { code: string; message: string }; trace_id: string };
type Runnable = { run: (r: unknown) => Promise<Envelope> };
const call = (fn: unknown, uid: string | null, data: unknown = {}): Promise<Envelope> =>
  (fn as Runnable).run(uid ? { auth: { uid, token: { uid } }, data } : { data });

const rnd = (): string => Math.random().toString(36).slice(2, 10);
const uid = (p: string): string => `fb_${p}_${Date.now()}_${rnd()}`;
const note_id = (): string => `n_${Date.now()}_${rnd()}${rnd()}`;

const created_notes = new Set<string>();
const created_senders = new Set<string>();

const send = async (sender: string, over: Record<string, unknown> = {}): Promise<Envelope> => {
  const id = (over.note_id as string) ?? note_id();
  created_notes.add(id);
  created_senders.add(sender);
  return call(submit_feedback, sender, {
    note_id: id,
    type: "bug",
    message: "I found a bug: the Kia payment shows twice.",
    app_version: "1.0",
    build: "52",
    screen: "PeriodPage",
    device: "iPhone16,1",
    os_version: "26.1",
    ...over,
  });
};

const note_doc = async (id: string) => (await db.collection("feedback").doc(id).get()).data();
const sender_doc = async (u: string) => (await db.collection("feedback_senders").doc(u).get()).data();

const OWNER = uid("owner");

beforeAll(async () => {
  await set_feature_flag(FEEDBACK_INBOX_FLAG, { enabled: true, enabled_user_ids: [OWNER], rollout_percentage: 0 });
  invalidate_flag_cache();
});

afterAll(async () => {
  const writer = db.bulkWriter();
  for (const id of created_notes) writer.delete(db.collection("feedback").doc(id));
  for (const u of created_senders) writer.delete(db.collection("feedback_senders").doc(u));
  await writer.close();
});

describe("submit_feedback", () => {
  it("refuses an unauthenticated call", async () => {
    await expect(call(submit_feedback, null, { note_id: note_id() })).rejects.toThrow(/authenticated/);
  });

  it("returns VALIDATION_ERROR for malformed input and writes nothing", async () => {
    const u = uid("val");
    const id = note_id();
    const res = await send(u, { note_id: id, type: "complaint" });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("VALIDATION_ERROR");
    expect(res.trace_id).toBeTruthy();
    expect(await note_doc(id)).toBeUndefined();
    expect(await sender_doc(u)).toBeUndefined();
  });

  it("stores the note with NO sender identity anywhere in it", async () => {
    const u = uid("anon");
    const id = note_id();
    const res = await send(u, { note_id: id, message: "  hello\r\nteam\u0000 " });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ note_id: id, deduped: false, remaining_today: MAX_FEEDBACK_PER_DAY - 1 });

    const d = await note_doc(id);
    expect(Object.keys(d!).sort()).toEqual(
      ["appVersion", "build", "createdAt", "device", "message", "osVersion", "readByOwner", "reply", "screen", "status", "type"].sort()
    );
    expect(d).toMatchObject({
      type: "bug", message: "hello\nteam", appVersion: "1.0", build: "52", screen: "PeriodPage",
      device: "iPhone16,1", osVersion: "26.1", status: "open", readByOwner: false, reply: null,
    });
    // The uid appears in no value either.
    expect(JSON.stringify(d)).not.toContain(u);

    expect(await sender_doc(u)).toEqual({
      noteIds: [id], dailyCount: 1, dailyDate: new Date().toISOString().slice(0, 10), retiredNoteIds: [],
    });
  });

  it("strips client-supplied identity fields (uid / email) — they never reach the store", async () => {
    const u = uid("smuggle");
    const id = note_id();
    await send(u, { note_id: id, user_id: u, userId: u, email: "me@example.com", status: "done", readByOwner: true });
    const d = await note_doc(id);
    expect(d).not.toHaveProperty("userId");
    expect(d).not.toHaveProperty("user_id");
    expect(d).not.toHaveProperty("email");
    expect(d?.status).toBe("open");
    expect(d?.readByOwner).toBe(false);
  });

  it("a retried send (same note id) is deduped: one note, counter unchanged", async () => {
    const u = uid("retry");
    const id = note_id();
    expect((await send(u, { note_id: id })).data.deduped).toBe(false);
    const again = await send(u, { note_id: id, message: "a different body" });
    expect(again.success).toBe(true);
    expect(again.data).toEqual({ note_id: id, deduped: true, remaining_today: MAX_FEEDBACK_PER_DAY - 1 });
    expect((await note_doc(id))?.message).toBe("I found a bug: the Kia payment shows twice.");
    expect((await sender_doc(u))?.dailyCount).toBe(1);
    expect((await sender_doc(u))?.noteIds).toEqual([id]);
  });

  it("five concurrent taps of the same note write exactly one note", async () => {
    const u = uid("doubletap");
    const id = note_id();
    const results = await Promise.all(Array.from({ length: 5 }, () => send(u, { note_id: id })));
    for (const r of results) expect(r.success || r.error?.code === "INTERNAL_ERROR").toBe(true);
    expect(results.filter((r) => r.success && r.data.deduped === false)).toHaveLength(1);
    expect((await sender_doc(u))?.dailyCount).toBe(1);
    expect((await sender_doc(u))?.noteIds).toEqual([id]);
  });

  it("another user can't reuse (or overwrite) a taken note id", async () => {
    const a = uid("a");
    const b = uid("b");
    const id = note_id();
    await send(a, { note_id: id, message: "A's note" });
    const res = await send(b, { note_id: id, message: "B overwrites" });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("ID_TAKEN");
    expect((await note_doc(id))?.message).toBe("A's note");
    expect(await sender_doc(b)).toBeUndefined();
  });

  it("refuses a bare starter or invisible-only note (EMPTY) and writes nothing", async () => {
    const u = uid("bare");
    for (const message of ["It would be cool if ", "I found a bug: ", "\u200B\u202E "]) {
      const id = note_id();
      const res = await send(u, { note_id: id, message });
      expect(res.error?.code).toBe("EMPTY");
      expect(await note_doc(id)).toBeUndefined();
    }
    expect(await sender_doc(u)).toBeUndefined();
  });

  it("5,000 characters plus a trailing newline is accepted and stored trimmed", async () => {
    const u = uid("len");
    const id = note_id();
    const res = await send(u, { note_id: id, message: `${"x".repeat(5000)}\r\n` });
    expect(res.success).toBe(true);
    expect((await note_doc(id))?.message).toHaveLength(5000);
  });

  it("refuses an empty note (EMPTY) and writes nothing", async () => {
    const u = uid("empty");
    const id = note_id();
    const res = await send(u, { note_id: id, message: "   \n " });
    expect(res.error?.code).toBe("EMPTY");
    expect(await note_doc(id)).toBeUndefined();
    expect(await sender_doc(u)).toBeUndefined();
  });

  it(`allows ${MAX_FEEDBACK_PER_DAY} notes a day, refuses the next (DAILY_LIMIT), writing nothing`, async () => {
    const u = uid("limit");
    for (let i = 0; i < MAX_FEEDBACK_PER_DAY; i++) {
      const r = await send(u);
      expect(r.success).toBe(true);
      expect(r.data.remaining_today).toBe(MAX_FEEDBACK_PER_DAY - 1 - i);
    }
    const id = note_id();
    const over = await send(u, { note_id: id });
    expect(over.success).toBe(false);
    expect(over.error?.code).toBe("DAILY_LIMIT");
    expect(await note_doc(id)).toBeUndefined();
    expect((await sender_doc(u))?.dailyCount).toBe(MAX_FEEDBACK_PER_DAY);
  });

  it("25 concurrent sends can never store more than 20 notes", async () => {
    const u = uid("burst");
    const ids = Array.from({ length: 25 }, () => note_id());
    const first = await Promise.all(ids.map((id) => send(u, { note_id: id })));
    // Transactions under heavy contention may abort (INTERNAL_ERROR) — a client retry resends.
    for (const r of first) expect(["DAILY_LIMIT", "INTERNAL_ERROR", undefined]).toContain(r.error?.code);
    const retry_ids = ids.filter((_, i) => first[i].error?.code === "INTERNAL_ERROR");
    for (const id of retry_ids) await send(u, { note_id: id });

    const stored = (await Promise.all(ids.map(note_doc))).filter(Boolean);
    expect(stored).toHaveLength(MAX_FEEDBACK_PER_DAY);
    const s = await sender_doc(u);
    expect(s?.dailyCount).toBe(MAX_FEEDBACK_PER_DAY);
    expect(s?.noteIds).toHaveLength(MAX_FEEDBACK_PER_DAY);
    expect(new Set(s?.noteIds).size).toBe(MAX_FEEDBACK_PER_DAY);
  });

  it("the limit resets on the next UTC day", async () => {
    const u = uid("rollover");
    created_senders.add(u);
    const today = Date.UTC(2031, 0, 5, 23, 59);
    const tomorrow = Date.UTC(2031, 0, 6, 0, 1);
    const run = (now: number) => {
      const id = note_id();
      created_notes.add(id);
      return submit_feedback_orchestrator(
        {
          trace_id: "t", span_id: "s", user_id: u, idempotency_key: id,
          input: { note_id: id, type: "idea", message: "hi", app_version: "1.0", build: "52" },
        },
        now
      );
    };
    for (let i = 0; i < MAX_FEEDBACK_PER_DAY; i++) expect((await run(today)).success).toBe(true);
    expect(await run(today)).toMatchObject({ success: false, code: "DAILY_LIMIT" });
    const next = await run(tomorrow);
    expect(next).toMatchObject({ success: true, data: { remaining_today: MAX_FEEDBACK_PER_DAY - 1 } });
    expect(await sender_doc(u)).toMatchObject({ dailyCount: 1, dailyDate: "2031-01-06" });
  });
});

describe("list_my_feedback (Sent tab)", () => {
  it("returns only the caller's notes, newest first, without inbox state or device facts", async () => {
    const me = uid("me");
    const other = uid("other");
    const first = note_id();
    const second = note_id();
    await send(me, { note_id: first, type: "idea", message: "first" });
    await send(other, { message: "not mine" });
    await send(me, { note_id: second, type: "question", message: "second" });

    const res = await call(list_my_feedback, me);
    expect(res.success).toBe(true);
    expect(res.data.notes.map((n: any) => n.id)).toEqual([second, first]);
    expect(res.data.notes[0]).toEqual({
      id: second, type: "question", message: "second", created_at_ms: expect.any(Number), reply: null,
    });
    for (const n of res.data.notes) {
      expect(n).not.toHaveProperty("status");
      expect(n).not.toHaveProperty("read_by_owner");
      expect(n).not.toHaveProperty("device");
    }
  });

  it("is empty for someone who never sent a note", async () => {
    const res = await call(list_my_feedback, uid("never"));
    expect(res).toMatchObject({ success: true, data: { notes: [] } });
  });

  it("refuses an unauthenticated call", async () => {
    await expect(call(list_my_feedback, null)).rejects.toThrow(/authenticated/);
  });
});

describe("get_feedback_status", () => {
  it("a regular user is not an owner and sees 0 unread", async () => {
    const res = await call(get_feedback_status, uid("regular"));
    expect(res).toMatchObject({ success: true, data: { is_owner: false, inbox_unread: 0 } });
  });

  it("the owner sees how many notes are unread", async () => {
    const before = (await call(get_feedback_status, OWNER)).data.inbox_unread;
    await send(uid("s"));
    await send(uid("s"));
    const res = await call(get_feedback_status, OWNER);
    expect(res.data.is_owner).toBe(true);
    expect(res.data.inbox_unread).toBe(before + 2);
  });
});

describe("manage_feedback_inbox", () => {
  const inbox = (uid_: string, data: unknown) => call(manage_feedback_inbox, uid_, data);
  const listed = async (data: Record<string, unknown> = {}): Promise<any[]> =>
    (await inbox(OWNER, { action: "list", ...data })).data.notes;

  it("refuses every action for a non-owner, changing nothing", async () => {
    const intruder = uid("intruder");
    const id = note_id();
    await send(uid("s"), { note_id: id });
    for (const data of [
      { action: "list" },
      { action: "mark_read", note_id: id },
      { action: "set_status", note_id: id, status: "done" },
      { action: "delete", note_id: id },
    ]) {
      const res = await inbox(intruder, data);
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe("PERMISSION_DENIED");
      expect(res.data).toBeUndefined();
    }
    expect(await note_doc(id)).toMatchObject({ status: "open", readByOwner: false });
  });

  it("rollout_percentage 100 still doesn't open the inbox to non-allowlisted users", async () => {
    await set_feature_flag(FEEDBACK_INBOX_FLAG, { rollout_percentage: 100 });
    invalidate_flag_cache();
    try {
      expect((await inbox(uid("rollout"), { action: "list" })).error?.code).toBe("PERMISSION_DENIED");
      expect((await call(get_feedback_status, uid("rollout"))).data.is_owner).toBe(false);
    } finally {
      await set_feature_flag(FEEDBACK_INBOX_FLAG, { rollout_percentage: 0 });
      invalidate_flag_cache();
    }
  });

  it("a disabled flag locks the owner out too", async () => {
    await set_feature_flag(FEEDBACK_INBOX_FLAG, { enabled: false });
    invalidate_flag_cache();
    try {
      expect((await inbox(OWNER, { action: "list" })).error?.code).toBe("PERMISSION_DENIED");
    } finally {
      await set_feature_flag(FEEDBACK_INBOX_FLAG, { enabled: true });
      invalidate_flag_cache();
    }
  });

  it("lists open notes newest first, with device facts and no sender", async () => {
    const s = uid("listed");
    const older = note_id();
    const newer = note_id();
    await send(s, { note_id: older, type: "idea" });
    await new Promise((r) => setTimeout(r, 5));
    await send(s, { note_id: newer, type: "bug" });

    const notes = await listed();
    const ids = notes.map((n) => n.id);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
    const item = notes.find((n) => n.id === newer);
    expect(item).toMatchObject({
      type: "bug", app_version: "1.0", build: "52", screen: "PeriodPage", device: "iPhone16,1",
      os_version: "26.1", status: "open", read_by_owner: false,
    });
    expect(JSON.stringify(item)).not.toContain(s);
  });

  it("filters by type", async () => {
    const idea = note_id();
    const bug = note_id();
    await send(uid("t"), { note_id: idea, type: "idea" });
    await send(uid("t"), { note_id: bug, type: "bug" });
    const ideas = await listed({ type: "idea" });
    expect(ideas.every((n) => n.type === "idea")).toBe(true);
    expect(ideas.map((n) => n.id)).toContain(idea);
    expect(ideas.map((n) => n.id)).not.toContain(bug);
  });

  it("mark_read clears one unread (once)", async () => {
    const id = note_id();
    await send(uid("r"), { note_id: id });
    const before = (await call(get_feedback_status, OWNER)).data.inbox_unread;
    expect((await inbox(OWNER, { action: "mark_read", note_id: id })).data).toEqual({ action: "mark_read", note_id: id, changed: true });
    expect((await note_doc(id))?.readByOwner).toBe(true);
    expect((await call(get_feedback_status, OWNER)).data.inbox_unread).toBe(before - 1);
    expect((await inbox(OWNER, { action: "mark_read", note_id: id })).data.changed).toBe(false);
  });

  it("done moves a note to the Done list and marks it read; reopening moves it back", async () => {
    const id = note_id();
    await send(uid("d"), { note_id: id });
    expect((await inbox(OWNER, { action: "set_status", note_id: id, status: "done" })).data.changed).toBe(true);
    expect(await note_doc(id)).toMatchObject({ status: "done", readByOwner: true });
    expect((await listed({ status: "done" })).map((n) => n.id)).toContain(id);
    expect((await listed({ status: "open" })).map((n) => n.id)).not.toContain(id);

    expect((await inbox(OWNER, { action: "set_status", note_id: id, status: "open" })).data.changed).toBe(true);
    expect(await note_doc(id)).toMatchObject({ status: "open", readByOwner: true });
    expect((await inbox(OWNER, { action: "set_status", note_id: id, status: "open" })).data.changed).toBe(false);
  });

  it("delete removes the note and takes it off the sender's Sent list", async () => {
    const s = uid("del");
    const keep = note_id();
    const gone = note_id();
    await send(s, { note_id: keep });
    await send(s, { note_id: gone });
    const res = await inbox(OWNER, { action: "delete", note_id: gone });
    expect(res.data).toEqual({ action: "delete", note_id: gone, changed: true });
    expect(await note_doc(gone)).toBeUndefined();
    expect((await sender_doc(s))?.noteIds).toEqual([keep]);
    expect((await call(list_my_feedback, s)).data.notes.map((n: any) => n.id)).toEqual([keep]);
    // Deleting again, or an id that never existed, changes nothing.
    expect((await inbox(OWNER, { action: "delete", note_id: gone })).data.changed).toBe(false);
    expect((await inbox(OWNER, { action: "delete", note_id: note_id() })).data.changed).toBe(false);
  });

  it("a late retry of a deleted note never brings it back (and doesn't count)", async () => {
    const s = uid("delretry");
    const gone = note_id();
    await send(s, { note_id: gone });
    expect((await inbox(OWNER, { action: "delete", note_id: gone })).data.changed).toBe(true);
    expect((await sender_doc(s))?.retiredNoteIds).toEqual([gone]);
    const retry = await send(s, { note_id: gone });
    expect(retry.success).toBe(true);
    expect(retry.data.deduped).toBe(true);
    expect(await note_doc(gone)).toBeUndefined();
    expect((await sender_doc(s))?.dailyCount).toBe(1);
    // Their next, new note still goes through and the retired id stays retired.
    const next = note_id();
    expect((await send(s, { note_id: next })).data.deduped).toBe(false);
    expect((await sender_doc(s))?.retiredNoteIds).toEqual([gone]);
  });

  it("mark_read / set_status on a missing note change nothing (no doc is created)", async () => {
    const id = note_id();
    expect((await inbox(OWNER, { action: "mark_read", note_id: id })).data.changed).toBe(false);
    expect((await inbox(OWNER, { action: "set_status", note_id: id, status: "done" })).data.changed).toBe(false);
    expect(await note_doc(id)).toBeUndefined();
  });

  it("validates input (bad action / malformed id)", async () => {
    expect((await inbox(OWNER, { action: "reply" })).error?.code).toBe("VALIDATION_ERROR");
    expect((await inbox(OWNER, { action: "delete", note_id: "../users/x" })).error?.code).toBe("VALIDATION_ERROR");
  });
});
