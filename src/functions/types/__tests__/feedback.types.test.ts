/**
 * Feedback input schemas — what the callables accept and refuse before any read or write.
 */
import {
  feedback_inbox_input_schema,
  MAX_FEEDBACK_LENGTH,
  submit_feedback_input_schema,
} from "../feedback.types";

const valid = {
  note_id: "abcdefghijklmnop",
  type: "idea",
  message: "It would be cool if…",
  app_version: "1.0",
  build: "52",
};

const parse = (over: Record<string, unknown>) => submit_feedback_input_schema.safeParse({ ...valid, ...over });

describe("submit_feedback_input_schema", () => {
  it("accepts the minimal valid input", () => {
    expect(submit_feedback_input_schema.safeParse(valid).success).toBe(true);
  });

  it("accepts all optional device facts", () => {
    expect(parse({ screen: "PeriodPage", device: "iPhone16,1", os_version: "26.1" }).success).toBe(true);
  });

  it.each(["idea", "howTo", "bug", "needThisToo", "question", "other"])("accepts type %s", (type) => {
    expect(parse({ type }).success).toBe(true);
  });

  it.each(["", "Idea", "complaint", null, 3])("refuses type %p", (type) => {
    expect(parse({ type }).success).toBe(false);
  });

  it("the schema only guards payload size (2× the limit); the 5,000 limit is checked after cleanup", () => {
    expect(parse({ message: "x".repeat(MAX_FEEDBACK_LENGTH) }).success).toBe(true);
    expect(parse({ message: `${"x".repeat(MAX_FEEDBACK_LENGTH)}\n` }).success).toBe(true);
    expect(parse({ message: "x".repeat(MAX_FEEDBACK_LENGTH * 2) }).success).toBe(true);
    expect(parse({ message: "x".repeat(MAX_FEEDBACK_LENGTH * 2 + 1) }).success).toBe(false);
  });

  it("refuses blank app_version / build (after trim)", () => {
    expect(parse({ app_version: "" }).success).toBe(false);
    expect(parse({ build: "   " }).success).toBe(false);
  });

  it("refuses invisible / bidi characters in device facts", () => {
    for (const bad of ["1.0\u202E", "\u200B", "x\u0085"]) {
      expect(parse({ app_version: bad }).success).toBe(false);
    }
    // repeated calls give the same answer (no regex state carried between calls)
    expect(parse({ screen: "Home" }).success).toBe(true);
    expect(parse({ screen: "Home" }).success).toBe(true);
  });

  it("lets an empty message through the schema (the domain refuses it with a friendly message)", () => {
    expect(parse({ message: "" }).success).toBe(true);
  });

  it("refuses a missing / non-string message", () => {
    const { message: _m, ...rest } = valid;
    expect(submit_feedback_input_schema.safeParse(rest).success).toBe(false);
    expect(parse({ message: 42 }).success).toBe(false);
  });

  it.each([
    ["too short", "abc"],
    ["has a slash (path injection)", "abcdefghijklmnop/x"],
    ["has a dot", "abcdefghijklmnop.x"],
    ["has spaces", "abcdefgh ijklmnop"],
    ["too long", "a".repeat(65)],
    ["empty", ""],
  ])("refuses a note_id that is %s", (_why, note_id) => {
    expect(parse({ note_id }).success).toBe(false);
  });

  it("accepts note ids with - and _ up to 64 chars", () => {
    expect(parse({ note_id: "A-b_" + "c".repeat(60) }).success).toBe(true);
  });

  it("requires app_version and build", () => {
    const { app_version: _a, ...no_version } = valid;
    const { build: _b, ...no_build } = valid;
    expect(submit_feedback_input_schema.safeParse(no_version).success).toBe(false);
    expect(submit_feedback_input_schema.safeParse(no_build).success).toBe(false);
  });

  it("bounds the device facts", () => {
    expect(parse({ app_version: "1".repeat(33) }).success).toBe(false);
    expect(parse({ build: "1".repeat(17) }).success).toBe(false);
    expect(parse({ screen: "s".repeat(65) }).success).toBe(false);
    expect(parse({ device: "d".repeat(65) }).success).toBe(false);
    expect(parse({ os_version: "o".repeat(33) }).success).toBe(false);
  });

  it("refuses control characters in device facts (log / display injection)", () => {
    expect(parse({ screen: "Home\nInjected" }).success).toBe(false);
    expect(parse({ device: "iPhone\u0000" }).success).toBe(false);
    expect(parse({ os_version: "26\u007F" }).success).toBe(false);
  });

  it("trims device facts", () => {
    const r = parse({ app_version: " 1.0 ", screen: " Home " });
    expect(r.success && r.data.app_version).toBe("1.0");
    expect(r.success && r.data.screen).toBe("Home");
  });

  it("drops unknown fields — a client can't smuggle a uid or email into the note", () => {
    const r = parse({ user_id: "u1", email: "a@b.com", userId: "u1", status: "done", read_by_owner: true });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(Object.keys(r.data).sort()).toEqual(["app_version", "build", "message", "note_id", "type"]);
  });
});

describe("feedback_inbox_input_schema", () => {
  const ok = (v: unknown) => feedback_inbox_input_schema.safeParse(v).success;

  it("list defaults to open, takes an optional type", () => {
    const r = feedback_inbox_input_schema.safeParse({ action: "list" });
    expect(r.success && r.data.action === "list" && r.data.status).toBe("open");
    expect(ok({ action: "list", status: "done", type: "bug" })).toBe(true);
    expect(ok({ action: "list", status: "archived" })).toBe(false);
    expect(ok({ action: "list", type: "spam" })).toBe(false);
  });

  it("mark_read / set_status / delete need a well-formed note id", () => {
    expect(ok({ action: "mark_read", note_id: "abcdefghijklmnop" })).toBe(true);
    expect(ok({ action: "mark_read", note_id: "../users/x" })).toBe(false);
    expect(ok({ action: "set_status", note_id: "abcdefghijklmnop", status: "done" })).toBe(true);
    expect(ok({ action: "set_status", note_id: "abcdefghijklmnop" })).toBe(false);
    expect(ok({ action: "delete", note_id: "abcdefghijklmnop" })).toBe(true);
    expect(ok({ action: "delete" })).toBe(false);
  });

  it("refuses unknown actions", () => {
    expect(ok({ action: "reply", note_id: "abcdefghijklmnop" })).toBe(false);
    expect(ok({})).toBe(false);
  });
});
