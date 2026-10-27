/**
 * Feedback domain service — every decision a send / list / inbox call makes (pure).
 */
import {
  after_owner_delete,
  is_bare_starter,
  is_inbox_owner,
  next_sender,
  normalize_message,
  plan_submit,
  sent_today,
  to_inbox_item,
  to_my_items,
  utc_day,
  without_note,
} from "../feedback.service";
import {
  FeedbackNote,
  FeedbackSender,
  MAX_FEEDBACK_LENGTH,
  MAX_FEEDBACK_PER_DAY,
  MAX_SENDER_NOTE_IDS,
  STARTER_OPENINGS,
  SubmitFeedbackInput,
} from "../../../types/feedback.types";

const NOW = Date.UTC(2026, 9, 25, 15, 30); // 2026-10-25 15:30 UTC
const DAY = "2026-10-25";
const ID = "note_abcdefghijklmnop";

const input = (over: Partial<SubmitFeedbackInput> = {}): SubmitFeedbackInput => ({
  note_id: ID,
  type: "bug",
  message: "I found a bug: the Kia payment shows twice.",
  app_version: "1.0",
  build: "52",
  screen: "PeriodPage",
  device: "iPhone16,1",
  os_version: "26.1",
  ...over,
});

const sender = (over: Partial<FeedbackSender> = {}): FeedbackSender => ({
  note_ids: [],
  daily_count: 0,
  daily_date: DAY,
  retired_note_ids: [],
  ...over,
});

const note = (id: string, over: Partial<FeedbackNote> = {}): FeedbackNote => ({
  id,
  type: "idea",
  message: `message ${id}`,
  app_version: "1.0",
  build: "52",
  screen: null,
  device: null,
  os_version: null,
  created_at_ms: NOW,
  status: "open",
  read_by_owner: false,
  reply: null,
  ...over,
});

describe("utc_day", () => {
  it("uses the UTC calendar day, not local time", () => {
    expect(utc_day(Date.UTC(2026, 9, 25, 0, 0, 0))).toBe("2026-10-25");
    expect(utc_day(Date.UTC(2026, 9, 25, 23, 59, 59, 999))).toBe("2026-10-25");
    expect(utc_day(Date.UTC(2026, 9, 26, 0, 0, 0))).toBe("2026-10-26");
  });
  it("handles year and leap-day boundaries", () => {
    expect(utc_day(Date.UTC(2026, 11, 31, 23, 59))).toBe("2026-12-31");
    expect(utc_day(Date.UTC(2028, 1, 29, 12))).toBe("2028-02-29");
  });
});

describe("normalize_message", () => {
  it("trims surrounding whitespace", () => {
    expect(normalize_message("  hello  \n")).toBe("hello");
  });
  it("keeps inner newlines and tabs, converts CRLF / CR to LF", () => {
    expect(normalize_message("a\r\nb\rc\td")).toBe("a\nb\nc\td");
  });
  it("removes other control characters (NUL, BEL, ESC, DEL…)", () => {
    expect(normalize_message("a\u0000b\u0007c\u001Bd\u007Fe")).toBe("abcde");
  });
  it("returns null for empty, whitespace-only and control-only text", () => {
    expect(normalize_message("")).toBeNull();
    expect(normalize_message("   \n\t  ")).toBeNull();
    expect(normalize_message("\u0000\u0001")).toBeNull();
  });
  it("keeps emoji and non-Latin text intact", () => {
    expect(normalize_message(" 💸 ¿Cómo? 日本 ")).toBe("💸 ¿Cómo? 日本");
  });
});

describe("sent_today", () => {
  it("is 0 with no record", () => expect(sent_today(null, DAY)).toBe(0));
  it("counts today's notes", () => expect(sent_today(sender({ daily_count: 7 }), DAY)).toBe(7));
  it("resets on a new UTC day", () => {
    expect(sent_today(sender({ daily_count: 20, daily_date: "2026-10-24" }), DAY)).toBe(0);
  });
  it("never goes negative on a corrupt counter", () => {
    expect(sent_today(sender({ daily_count: -5 }), DAY)).toBe(0);
  });
});

describe("plan_submit — writes", () => {
  it("first-ever note: writes the note and a new sender record", () => {
    const plan = plan_submit(input(), null, false, NOW);
    expect(plan.kind).toBe("write");
    if (plan.kind !== "write") return;
    expect(plan.note).toEqual({
      id: ID,
      type: "bug",
      message: "I found a bug: the Kia payment shows twice.",
      app_version: "1.0",
      build: "52",
      screen: "PeriodPage",
      device: "iPhone16,1",
      os_version: "26.1",
      created_at_ms: NOW,
      status: "open",
      read_by_owner: false,
      reply: null,
    });
    expect(plan.sender).toEqual({ note_ids: [ID], daily_count: 1, daily_date: DAY, retired_note_ids: [] });
    expect(plan.remaining_today).toBe(MAX_FEEDBACK_PER_DAY - 1);
  });

  it("the stored note has NO sender field of any kind (D2/D7)", () => {
    const plan = plan_submit(input(), null, false, NOW);
    if (plan.kind !== "write") throw new Error("expected write");
    const keys = Object.keys(plan.note).sort();
    expect(keys).toEqual(
      [
        "app_version", "build", "created_at_ms", "device", "id", "message", "os_version",
        "read_by_owner", "reply", "screen", "status", "type",
      ].sort()
    );
    const text = JSON.stringify(plan.note).toLowerCase();
    for (const word of ["uid", "user", "email", "name", "sender", "owner_id", "userid"]) {
      expect(keys.some((k) => k.toLowerCase().includes(word))).toBe(false);
      void text;
    }
  });

  it("stores the cleaned message, not the raw one", () => {
    const plan = plan_submit(input({ message: "  hi\r\nthere\u0000  " }), null, false, NOW);
    if (plan.kind !== "write") throw new Error("expected write");
    expect(plan.note.message).toBe("hi\nthere");
  });

  it("blank optional device facts become null, never empty strings", () => {
    const plan = plan_submit(
      input({ screen: "  ", device: "", os_version: undefined }),
      null,
      false,
      NOW
    );
    if (plan.kind !== "write") throw new Error("expected write");
    expect(plan.note.screen).toBeNull();
    expect(plan.note.device).toBeNull();
    expect(plan.note.os_version).toBeNull();
  });

  it.each(["idea", "howTo", "bug", "needThisToo", "question", "other"] as const)(
    "keeps the chosen starter type %s",
    (type) => {
      const plan = plan_submit(input({ type }), null, false, NOW);
      if (plan.kind !== "write") throw new Error("expected write");
      expect(plan.note.type).toBe(type);
    }
  );

  it("19th note of the day still goes through, leaving 0", () => {
    const plan = plan_submit(input(), sender({ daily_count: 19 }), false, NOW);
    expect(plan.kind).toBe("write");
    if (plan.kind === "write") expect(plan.remaining_today).toBe(0);
  });

  it("yesterday's full counter doesn't block today", () => {
    const plan = plan_submit(
      input(),
      sender({ daily_count: 20, daily_date: "2026-10-24", note_ids: ["old_aaaaaaaaaaaaaaaa"] }),
      false,
      NOW
    );
    expect(plan.kind).toBe("write");
    if (plan.kind !== "write") return;
    expect(plan.sender.daily_count).toBe(1);
    expect(plan.sender.daily_date).toBe(DAY);
    expect(plan.sender.note_ids).toEqual([ID, "old_aaaaaaaaaaaaaaaa"]);
  });

  it("exactly the length limit is allowed", () => {
    const plan = plan_submit(input({ message: "x".repeat(MAX_FEEDBACK_LENGTH) }), null, false, NOW);
    expect(plan.kind).toBe("write");
  });
});

describe("plan_submit — refusals and dedupe", () => {
  it("refuses the 21st note of the day (DAILY_LIMIT), writing nothing", () => {
    const plan = plan_submit(input(), sender({ daily_count: 20 }), false, NOW);
    expect(plan).toEqual({
      kind: "rejected",
      code: "DAILY_LIMIT",
      message: "You've sent a lot today — try again tomorrow.",
    });
  });

  it("refuses a corrupt counter above the limit too", () => {
    expect(plan_submit(input(), sender({ daily_count: 999 }), false, NOW).kind).toBe("rejected");
  });

  it("refuses an empty / whitespace-only note (EMPTY)", () => {
    for (const message of ["", "   ", "\n\n", "\u0000"]) {
      const plan = plan_submit(input({ message }), null, false, NOW);
      expect(plan.kind === "rejected" && plan.code).toBe("EMPTY");
    }
  });

  it("refuses a note over the length limit after cleanup (TOO_LONG)", () => {
    const plan = plan_submit(input({ message: "x".repeat(MAX_FEEDBACK_LENGTH + 1) }), null, false, NOW);
    expect(plan.kind === "rejected" && plan.code).toBe("TOO_LONG");
  });

  it("a retried send of the sender's own note is deduped (nothing written)", () => {
    const plan = plan_submit(input(), sender({ note_ids: [ID], daily_count: 3 }), true, NOW);
    expect(plan).toEqual({ kind: "deduped", remaining_today: MAX_FEEDBACK_PER_DAY - 3 });
  });

  it("dedupe wins over the daily limit (a retry of the 20th note isn't refused)", () => {
    const plan = plan_submit(input(), sender({ note_ids: [ID], daily_count: 20 }), true, NOW);
    expect(plan).toEqual({ kind: "deduped", remaining_today: 0 });
  });

  it("dedupe wins over an empty message (the original was valid)", () => {
    const plan = plan_submit(input({ message: "" }), sender({ note_ids: [ID] }), true, NOW);
    expect(plan.kind).toBe("deduped");
  });

  it("an id that exists but isn't the sender's is refused (ID_TAKEN), never overwritten", () => {
    expect(plan_submit(input(), null, true, NOW).kind === "rejected").toBe(true);
    const plan = plan_submit(input(), sender({ note_ids: ["other_aaaaaaaaaaaaaa"] }), true, NOW);
    expect(plan.kind === "rejected" && plan.code).toBe("ID_TAKEN");
  });

  it("is deterministic", () => {
    const s = sender({ daily_count: 4, note_ids: ["a_aaaaaaaaaaaaaaaa"] });
    expect(plan_submit(input(), s, false, NOW)).toEqual(plan_submit(input(), s, false, NOW));
  });

  it("does not mutate the sender record it was given", () => {
    const s = sender({ daily_count: 4, note_ids: ["a_aaaaaaaaaaaaaaaa"] });
    const copy = JSON.parse(JSON.stringify(s));
    plan_submit(input(), s, false, NOW);
    expect(s).toEqual(copy);
  });
});

describe("next_sender", () => {
  it("puts the newest id first", () => {
    expect(next_sender(sender({ note_ids: ["b", "a"] }), "c", DAY).note_ids).toEqual(["c", "b", "a"]);
  });
  it("never duplicates an id", () => {
    expect(next_sender(sender({ note_ids: ["b", "c", "a"] }), "c", DAY).note_ids).toEqual(["c", "b", "a"]);
  });
  it(`keeps at most ${MAX_SENDER_NOTE_IDS} ids, dropping the oldest`, () => {
    const ids = Array.from({ length: MAX_SENDER_NOTE_IDS }, (_, i) => `n${i}`);
    const next = next_sender(sender({ note_ids: ids }), "new", DAY);
    expect(next.note_ids).toHaveLength(MAX_SENDER_NOTE_IDS);
    expect(next.note_ids[0]).toBe("new");
    expect(next.note_ids).not.toContain(`n${MAX_SENDER_NOTE_IDS - 1}`);
  });
  it("trims an already-oversized list back to the bound", () => {
    const ids = Array.from({ length: MAX_SENDER_NOTE_IDS + 50 }, (_, i) => `n${i}`);
    expect(next_sender(sender({ note_ids: ids }), "new", DAY).note_ids).toHaveLength(MAX_SENDER_NOTE_IDS);
  });
  it("counts today and resets on a new day", () => {
    expect(next_sender(sender({ daily_count: 5 }), "x", DAY).daily_count).toBe(6);
    expect(next_sender(sender({ daily_count: 5, daily_date: "2026-10-01" }), "x", DAY).daily_count).toBe(1);
    expect(next_sender(null, "x", DAY)).toEqual({ note_ids: ["x"], daily_count: 1, daily_date: DAY, retired_note_ids: [] });
  });
  it("keeps the retired ids", () => {
    expect(next_sender(sender({ retired_note_ids: ["gone"] }), "x", DAY).retired_note_ids).toEqual(["gone"]);
  });
});

describe("normalize_message — invisible characters", () => {
  it("strips C1 controls, zero-width space, BOM, word joiner and bidi overrides", () => {
    expect(normalize_message("a\u0085b\u200Bc\uFEFFd\u2060e\u202Ef\u2066g")).toBe("abcdefg");
  });
  it("a note of only invisible characters / joiners is empty", () => {
    for (const m of ["\u200B", "\u200B \u200B", "\u202E\u200D", "\uFEFF\n\u200C"]) {
      expect(normalize_message(m)).toBeNull();
    }
  });
  it("keeps ZWJ inside emoji sequences (family, flags)", () => {
    const family = "👨\u200D👩\u200D👧";
    expect(normalize_message(`hi ${family}`)).toBe(`hi ${family}`);
  });
});

describe("bare starters (D4)", () => {
  it("every starter opening alone is refused as EMPTY, with or without spaces", () => {
    for (const opening of STARTER_OPENINGS) {
      for (const m of [opening, `${opening} `, `  ${opening}\n`]) {
        const plan = plan_submit(input({ message: m }), null, false, NOW);
        expect(plan).toMatchObject({ kind: "rejected", code: "EMPTY" });
      }
    }
  });
  it("a starter plus any real words goes through", () => {
    expect(plan_submit(input({ message: "I found a bug: x" }), null, false, NOW).kind).toBe("write");
  });
  it("is_bare_starter matches whole openings only", () => {
    expect(is_bare_starter("It would be cool if")).toBe(true);
    expect(is_bare_starter("It would be cool")).toBe(false);
    expect(is_bare_starter("It would be cool if it")).toBe(false);
  });
  it("matches the app's starter prefills exactly (keep both lists in sync)", () => {
    // Mirror of FamilyFinanceMobile src/features/feedback/types STARTERS[].prefill (trimmed, non-empty).
    const app = ["It would be cool if ", "I don't know how to ", "I found a bug: ", "I need this too… ", "I just have a question… "];
    expect([...STARTER_OPENINGS]).toEqual(app.map((p) => p.trim()));
  });
});

describe("length is checked AFTER cleanup", () => {
  it("5,000 characters plus surrounding whitespace / CRLF padding is allowed", () => {
    const m = `\r\n  ${"x".repeat(MAX_FEEDBACK_LENGTH)}  \r\n`;
    expect(plan_submit(input({ message: m }), null, false, NOW).kind).toBe("write");
  });
  it("5,001 visible characters is refused (TOO_LONG)", () => {
    const plan = plan_submit(input({ message: ` ${"x".repeat(MAX_FEEDBACK_LENGTH + 1)} ` }), null, false, NOW);
    expect(plan).toMatchObject({ kind: "rejected", code: "TOO_LONG" });
  });
});

describe("owner delete → late retry", () => {
  it("after_owner_delete takes the id off the list and retires it (bounded, newest first)", () => {
    const s = sender({ note_ids: ["a", ID, "b"], retired_note_ids: ["old"] });
    expect(after_owner_delete(s, ID)).toEqual({ ...s, note_ids: ["a", "b"], retired_note_ids: [ID, "old"] });
    const full = sender({ retired_note_ids: Array.from({ length: MAX_SENDER_NOTE_IDS }, (_, i) => `r${i}`) });
    const next = after_owner_delete(full, ID);
    expect(next.retired_note_ids).toHaveLength(MAX_SENDER_NOTE_IDS);
    expect(next.retired_note_ids[0]).toBe(ID);
  });
  it("a retry of a deleted note is deduped — never re-created, never counted", () => {
    const s = after_owner_delete(sender({ note_ids: [ID], daily_count: 20 }), ID);
    expect(plan_submit(input(), s, false, NOW)).toEqual({ kind: "deduped", remaining_today: 0 });
  });
  it("another user can't use a retired id to dodge anything (their record doesn't have it)", () => {
    expect(plan_submit(input(), sender(), false, NOW).kind).toBe("write");
  });
});

describe("without_note", () => {
  it("removes every copy of the id and keeps order", () => {
    expect(without_note(["a", "b", "a", "c"], "a")).toEqual(["b", "c"]);
  });
  it("is a no-op when absent", () => expect(without_note(["a"], "z")).toEqual(["a"]));
});

describe("to_my_items (Sent tab)", () => {
  it("follows the sender's order (newest first), not the read order", () => {
    const items = to_my_items(["c", "a", "b"], [note("a"), note("b"), note("c")]);
    expect(items.map((i) => i.id)).toEqual(["c", "a", "b"]);
  });
  it("drops ids whose note was deleted", () => {
    expect(to_my_items(["a", "gone", "b"], [note("a"), note("b")]).map((i) => i.id)).toEqual(["a", "b"]);
  });
  it("exposes only the sender-facing fields — never inbox state or device facts", () => {
    const [item] = to_my_items(["a"], [note("a", { status: "done", read_by_owner: true, device: "iPhone" })]);
    expect(Object.keys(item).sort()).toEqual(["created_at_ms", "id", "message", "reply", "type"]);
  });
  it("passes a reply through (v2)", () => {
    const reply = { message: "Try Split.", replied_at_ms: NOW };
    expect(to_my_items(["a"], [note("a", { reply })])[0].reply).toEqual(reply);
  });
  it("is empty for no ids", () => expect(to_my_items([], [note("a")])).toEqual([]));
});

describe("to_inbox_item", () => {
  it("is exactly the stored note fields", () => {
    const n = note("a", { device: "iPhone16,1", screen: "Home", os_version: "26.1" });
    expect(to_inbox_item(n)).toEqual(n);
  });
});

describe("is_inbox_owner", () => {
  const OWNER = "owner_uid";
  it("an enabled flag listing the user → owner", () => {
    expect(is_inbox_owner({ enabled: true, enabled_user_ids: [OWNER] }, OWNER)).toBe(true);
  });
  it("not listed → not owner", () => {
    expect(is_inbox_owner({ enabled: true, enabled_user_ids: [OWNER] }, "someone")).toBe(false);
  });
  it("a disabled flag → nobody", () => {
    expect(is_inbox_owner({ enabled: false, enabled_user_ids: [OWNER] }, OWNER)).toBe(false);
  });
  it("enabled must be exactly true (truthy strings don't count)", () => {
    expect(is_inbox_owner({ enabled: "true", enabled_user_ids: [OWNER] }, OWNER)).toBe(false);
  });
  it("rollout_percentage 100 does NOT make everyone an owner", () => {
    const flag = { enabled: true, enabled_user_ids: [], rollout_percentage: 100 };
    expect(is_inbox_owner(flag, "anyone")).toBe(false);
  });
  it("group allowlists are ignored", () => {
    const flag = { enabled: true, enabled_user_ids: [], enabled_group_ids: ["g1"] };
    expect(is_inbox_owner(flag, "anyone")).toBe(false);
  });
  it("missing flag / malformed ids / empty uid → nobody", () => {
    expect(is_inbox_owner(null, OWNER)).toBe(false);
    expect(is_inbox_owner({ enabled: true, enabled_user_ids: OWNER }, OWNER)).toBe(false);
    expect(is_inbox_owner({ enabled: true }, OWNER)).toBe(false);
    expect(is_inbox_owner({ enabled: true, enabled_user_ids: [""] }, "")).toBe(false);
  });
});
