/**
 * Ideas domain (Planning-Module v1): who may use a list, cleaning, bounds, and what each action
 * writes. Pure functions only.
 */
import {
  can_use_list,
  clean_text,
  clean_topic,
  IdeaTopics,
  is_real_date,
  plan_comment,
  plan_convert,
  plan_create,
  plan_delete,
  plan_delete_comment,
  plan_edit,
  plan_like,
  plan_restore,
  topics_after,
} from "../idea.service";
import {
  CONVERTED_RETENTION_MS,
  Idea,
  IdeaComment,
  MAX_COMMENTS_PER_IDEA,
  MAX_IDEA_TITLE,
  MAX_OPEN_IDEAS,
  MAX_TOPICS,
} from "../../../types/ideas.types";
import { Group } from "../../../types/sharing.types";

const NOW = 1_800_000_000_000;
const ID = "idea_0123456789abcdef";

const group = (over: Partial<Group> = {}): Group => ({
  id: "g1",
  name: "Household",
  owner_id: "u1",
  members: { u1: { role: "owner", joined_at_ms: 0 }, u2: { role: "full", joined_at_ms: 0 } },
  member_ids: ["u1", "u2"],
  created_at_ms: 0,
  deleted_at_ms: null,
  ...over,
} as unknown as Group);

const idea = (over: Partial<Idea> = {}): Idea => ({
  id: ID,
  owner_key: "group:g1",
  created_by: "u1",
  title: "Maya's birthday party",
  notes: "",
  kind: "idea",
  topic: null,
  amount: null,
  date: null,
  liked_by: [],
  comment_count: 0,
  status: "open",
  converted_to: null,
  created_at_ms: 1,
  updated_at_ms: 1,
  updated_by: "u1",
  expire_at_ms: null,
  ...over,
});

const ctx = { owner_key: "u1", actor_id: "u1", now_ms: NOW, open_count: 0 };
const NONE: IdeaTopics = { names: [], counts: {} };
const T = (counts: Record<string, number>): IdeaTopics => ({ names: Object.keys(counts), counts });

describe("can_use_list", () => {
  it("Me list: only its person", () => {
    expect(can_use_list("u1", "u1", null)).toBe(true);
    expect(can_use_list("u1", "u2", null)).toBe(false);
  });
  it("group list: any member of that active group", () => {
    expect(can_use_list("group:g1", "u2", group())).toBe(true);
    expect(can_use_list("group:g1", "u3", group())).toBe(false);
    expect(can_use_list("group:g1", "u1", null)).toBe(false);
    expect(can_use_list("group:g1", "u1", group({ id: "g2" }))).toBe(false);
    expect(can_use_list("group:g1", "u1", group({ deleted_at_ms: 5 }))).toBe(false);
  });
});

describe("cleaning", () => {
  it("one-line text collapses whitespace; notes keep line breaks", () => {
    expect(clean_text("  Ski   trip\n with kids ", true)).toBe("Ski trip with kids");
    expect(clean_text("• Park\r\n• Cake​ ", false)).toBe("• Park\n• Cake");
  });
  it("topics: empty is none; too long is refused", () => {
    expect(clean_topic("  ")).toBeNull();
    expect(clean_topic(null)).toBeNull();
    expect(clean_topic(" Home ")).toBe("Home");
    expect(clean_topic("x".repeat(41))).toEqual({ error: expect.any(String) });
  });
  it("dates must exist", () => {
    expect(is_real_date("2026-11-22")).toBe(true);
    expect(is_real_date("2026-02-30")).toBe(false);
    expect(is_real_date("2028-02-29")).toBe(true);
  });
});

describe("topics_after (usage counts)", () => {
  it("adds a new name at the end; reuse counts up", () => {
    expect(topics_after(T({ Home: 1 }), null, "Garden")).toEqual(T({ Home: 1, Garden: 1 }));
    expect(topics_after(T({ Home: 1 }), null, "Home")).toEqual(T({ Home: 2 }));
  });
  it("moving an idea between topics moves the count; a topic nobody uses drops out", () => {
    expect(topics_after(T({ Home: 1, Trip: 2 }), "Home", "Trip")).toEqual(T({ Trip: 3 }));
    expect(topics_after(T({ Home: 2 }), "Home", null)).toEqual(T({ Home: 1 }));
  });
  it("same topic = no change", () => {
    expect(topics_after(T({ Home: 1 }), "Home", "Home")).toBeNull();
    expect(topics_after(NONE, null, null)).toBeNull();
  });
  it("the cap counts only topics in use, so old names never lock a list", () => {
    const full = T(Object.fromEntries(Array.from({ length: MAX_TOPICS }, (_, i) => [`t${i}`, 1])));
    expect(topics_after(full, null, "new")).toEqual({ error: expect.any(String) });
    // Moving the last idea off t0 frees a slot for the new name.
    const moved = topics_after(full, "t0", "new") as IdeaTopics;
    expect(moved.names).toHaveLength(MAX_TOPICS);
    expect(moved.names).not.toContain("t0");
    expect(moved.names).toContain("new");
  });
  it("refuses reserved key names", () => {
    expect(clean_topic("__name__")).toEqual({ error: expect.any(String) });
  });
});

describe("plan_create", () => {
  it("only the title is required (D6); the rest defaults to empty", () => {
    const plan = plan_create({ idea_id: ID, title: "  Ski trip " }, ctx, null, NONE);
    expect(plan.kind).toBe("write");
    if (plan.kind !== "write") return;
    expect(plan.idea).toMatchObject({
      id: ID, owner_key: "u1", created_by: "u1", title: "Ski trip", notes: "", kind: "idea",
      topic: null, amount: null, date: null, liked_by: [], comment_count: 0, status: "open",
      created_at_ms: NOW, updated_at_ms: NOW, expire_at_ms: null,
    });
    expect(plan.topics).toBeNull();
  });
  it("keeps every optional field and adds a new topic to the list", () => {
    const plan = plan_create(
      { idea_id: ID, title: "Party", notes: "• Park", kind: "budget", topic: "Kids", amount: 250, date: "2026-11-22" },
      ctx, null, T({ Home: 1 })
    );
    expect(plan.kind === "write" && plan.idea).toMatchObject({ kind: "budget", topic: "Kids", amount: 250, date: "2026-11-22", notes: "• Park" });
    expect(plan.kind === "write" && plan.topics).toEqual(T({ Home: 1, Kids: 1 }));
  });
  it("refuses an empty title, a fake date, a full list", () => {
    expect(plan_create({ idea_id: ID, title: " ​ " }, ctx, null, NONE).kind).toBe("rejected");
    expect(plan_create({ idea_id: ID, title: "x".repeat(MAX_IDEA_TITLE + 1) }, ctx, null, NONE).kind).toBe("rejected");
    expect(plan_create({ idea_id: ID, title: "a", date: "2026-02-30" }, ctx, null, NONE).kind).toBe("rejected");
    expect(plan_create({ idea_id: ID, title: "a" }, { ...ctx, open_count: MAX_OPEN_IDEAS }, null, NONE).kind).toBe("rejected");
  });
  it("a retried create finds its own idea and writes nothing; someone else's id is refused", () => {
    const mine = idea({ owner_key: "u1", created_by: "u1" });
    expect(plan_create({ idea_id: ID, title: "a" }, ctx, mine, NONE)).toEqual({ kind: "noop", result: { idea_id: ID, deduped: true } });
    expect(plan_create({ idea_id: ID, title: "a" }, { ...ctx, actor_id: "u9" }, mine, NONE).kind).toBe("rejected");
  });
});

describe("plan_edit", () => {
  it("changes only the fields sent; null clears", () => {
    const plan = plan_edit(idea({ amount: 100, date: "2026-11-01" }), { amount: null, kind: "goal" }, "u2", NOW, NONE);
    expect(plan.kind === "write" && plan.idea).toMatchObject({ amount: null, kind: "goal", date: "2026-11-01", updated_by: "u2", updated_at_ms: NOW });
  });
  it("nothing changed → no write", () => {
    expect(plan_edit(idea(), { title: "Maya's birthday party" }, "u1", NOW, NONE).kind).toBe("noop");
  });
  it("a converted idea can't be edited", () => {
    expect(plan_edit(idea({ status: "converted" }), { title: "x" }, "u1", NOW, NONE).kind).toBe("rejected");
  });
});

describe("plan_convert / plan_restore", () => {
  it("convert: leaves the open list, keeps a link, expires after the retention", () => {
    const plan = plan_convert(idea({ topic: "Kids" }), { kind: "budget", id: "b1" }, "u1", NOW, T({ Kids: 1, Home: 1 }));
    expect(plan.kind === "write" && plan.topics).toEqual(T({ Home: 1 }));
    expect(plan.kind === "write" && plan.idea).toMatchObject({
      status: "converted", converted_to: { kind: "budget", id: "b1" }, expire_at_ms: NOW + CONVERTED_RETENTION_MS,
    });
  });
  it("the same convert again is a no-op; a different one is refused", () => {
    const done = idea({ status: "converted", converted_to: { kind: "budget", id: "b1" } });
    expect(plan_convert(done, { kind: "budget", id: "b1" }, "u1", NOW, NONE).kind).toBe("noop");
    expect(plan_convert(done, { kind: "goal", id: "x" }, "u1", NOW, NONE).kind).toBe("rejected");
  });
  it("restore puts it back (topic counted again) and clears the expiry", () => {
    const done = idea({ status: "converted", converted_to: { kind: "budget", id: "b1" }, expire_at_ms: 9, topic: "Kids" });
    const plan = plan_restore(done, "u1", NOW, NONE, 0);
    expect(plan.kind === "write" && plan.idea).toMatchObject({ status: "open", converted_to: null, expire_at_ms: null, topic: "Kids" });
    expect(plan.kind === "write" && plan.topics).toEqual(T({ Kids: 1 }));
    expect(plan_restore(idea(), "u1", NOW, NONE, 0).kind).toBe("noop");
  });
  it("restore respects the open-ideas cap", () => {
    const done = idea({ status: "converted", converted_to: { kind: "budget", id: "b1" } });
    expect(plan_restore(done, "u1", NOW, NONE, MAX_OPEN_IDEAS).kind).toBe("rejected");
  });
});

describe("plan_like", () => {
  it("adds and removes the person once", () => {
    const liked = plan_like(idea(), "u2", true, NOW);
    expect(liked.kind === "write" && liked.idea?.liked_by).toEqual(["u2"]);
    expect(plan_like(idea({ liked_by: ["u2"] }), "u2", true, NOW).kind).toBe("noop");
    const un = plan_like(idea({ liked_by: ["u1", "u2"] }), "u2", false, NOW);
    expect(un.kind === "write" && un.idea?.liked_by).toEqual(["u1"]);
  });
});

describe("comments", () => {
  const C = "comment_0123456789ab";
  it("adds a comment and counts it", () => {
    const plan = plan_comment(idea(), C, " Park is cheaper ", null, "u2", NOW);
    expect(plan.kind).toBe("write");
    if (plan.kind !== "write") return;
    expect(plan.comment).toEqual({ set: { id: C, idea_id: ID, owner_key: "group:g1", author_id: "u2", text: "Park is cheaper", created_at_ms: NOW } });
    expect(plan.idea?.comment_count).toBe(1);
  });
  it("refuses empty text and the cap; a retry writes nothing", () => {
    expect(plan_comment(idea(), C, "  ", null, "u2", NOW).kind).toBe("rejected");
    expect(plan_comment(idea({ comment_count: MAX_COMMENTS_PER_IDEA }), C, "hi", null, "u2", NOW).kind).toBe("rejected");
    const mine: IdeaComment = { id: C, idea_id: ID, owner_key: "group:g1", author_id: "u2", text: "hi", created_at_ms: 1 };
    expect(plan_comment(idea({ comment_count: 1 }), C, "hi", mine, "u2", NOW).kind).toBe("noop");
  });
  it("only the author deletes; deleting a missing one is a no-op", () => {
    const c: IdeaComment = { id: C, idea_id: ID, owner_key: "group:g1", author_id: "u2", text: "hi", created_at_ms: 1 };
    expect(plan_delete_comment(idea({ comment_count: 1 }), C, c, "u1").kind).toBe("rejected");
    const del = plan_delete_comment(idea({ comment_count: 1 }), C, c, "u2");
    expect(del.kind === "write" && del.comment).toEqual({ delete: C });
    expect(del.kind === "write" && del.idea?.comment_count).toBe(0);
    expect(plan_delete_comment(idea(), C, null, "u2").kind).toBe("noop");
  });
});

describe("plan_delete", () => {
  it("deletes an idea; a missing one is a no-op", () => {
    expect(plan_delete(ID, idea({ topic: "Kids" }), T({ Kids: 1 }))).toMatchObject({
      kind: "write", idea: null, topics: { names: [], counts: {} }, result: { deleted: true },
    });
    expect(plan_delete(ID, null, NONE)).toEqual({ kind: "noop", result: { idea_id: ID, deleted: false } });
  });
});
