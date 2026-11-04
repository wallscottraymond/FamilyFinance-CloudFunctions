/**
 * Waitlist domain service — every decision a signup makes (pure).
 */
import { client_ip, entry_id, ip_limit_id, plan_join, utc_day } from "../waitlist.service";
import {
  JoinWaitlistInput,
  join_waitlist_input_schema,
  LIMIT_RETENTION_MS,
  MAX_ATTEMPTS_PER_IP_PER_DAY,
  MAX_NEW_SIGNUPS_PER_DAY,
} from "../../../types/waitlist.types";

const NOW = Date.UTC(2026, 10, 2, 15, 30);
const DAY = "2026-11-02";
const YESTERDAY = "2026-11-01";
const INPUT: JoinWaitlistInput = { email: "a@example.com", source: "hero" };
const EMPTY = { entry_exists: false, ip_counter: null, global_counter: null };

describe("plan_join", () => {
  it("a new email is written and counted against both limits", () => {
    const plan = plan_join(INPUT, EMPTY, NOW);
    expect(plan.status).toBe("joined");
    expect(plan.entry).toEqual({ email: "a@example.com", source: "hero", created_at_ms: NOW });
    expect(plan.ip_counter).toEqual({ day: DAY, count: 1 });
    expect(plan.global_counter).toEqual({ day: DAY, count: 1 });
    expect(plan.limit_expires_at_ms).toBe(NOW + LIMIT_RETENTION_MS);
  });

  it("a repeat email writes no entry and skips the daily cap, but counts as an attempt", () => {
    const plan = plan_join(INPUT, { ...EMPTY, entry_exists: true }, NOW);
    expect(plan.status).toBe("already_joined");
    expect(plan.entry).toBeNull();
    expect(plan.global_counter).toBeNull();
    expect(plan.ip_counter).toEqual({ day: DAY, count: 1 });
  });

  it("the attempt at the network limit is refused and writes nothing", () => {
    const at_limit = { day: DAY, count: MAX_ATTEMPTS_PER_IP_PER_DAY };
    const plan = plan_join(INPUT, { ...EMPTY, ip_counter: at_limit }, NOW);
    expect(plan.status).toBe("rate_limited");
    expect(plan.entry).toBeNull();
    expect(plan.ip_counter).toBeNull();
    expect(plan.global_counter).toBeNull();
  });

  it("the last attempt under the network limit is allowed", () => {
    const under = { day: DAY, count: MAX_ATTEMPTS_PER_IP_PER_DAY - 1 };
    const plan = plan_join(INPUT, { ...EMPTY, ip_counter: under }, NOW);
    expect(plan.status).toBe("joined");
    expect(plan.ip_counter?.count).toBe(MAX_ATTEMPTS_PER_IP_PER_DAY);
  });

  it("at the daily cap a new email is refused; someone already listed still succeeds", () => {
    const full = { day: DAY, count: MAX_NEW_SIGNUPS_PER_DAY };
    const refused = plan_join(INPUT, { ...EMPTY, global_counter: full }, NOW);
    expect(refused.status).toBe("rate_limited");
    expect(refused.entry).toBeNull();
    expect(refused.global_counter).toBeNull();
    expect(refused.ip_counter).toEqual({ day: DAY, count: 1 });

    const repeat = plan_join(INPUT, { ...EMPTY, entry_exists: true, global_counter: full }, NOW);
    expect(repeat.status).toBe("already_joined");
  });

  it("counters from an earlier day count as zero", () => {
    const plan = plan_join(
      INPUT,
      {
        entry_exists: false,
        ip_counter: { day: YESTERDAY, count: MAX_ATTEMPTS_PER_IP_PER_DAY },
        global_counter: { day: YESTERDAY, count: MAX_NEW_SIGNUPS_PER_DAY },
      },
      NOW
    );
    expect(plan.status).toBe("joined");
    expect(plan.ip_counter?.count).toBe(1);
    expect(plan.global_counter?.count).toBe(1);
  });
});

describe("join_waitlist_input_schema", () => {
  it("trims and lowercases, so one address is one entry", () => {
    const a = join_waitlist_input_schema.parse({ email: "  Person@Example.COM " });
    const b = join_waitlist_input_schema.parse({ email: "person@example.com" });
    expect(a.email).toBe("person@example.com");
    expect(entry_id(a.email)).toBe(entry_id(b.email));
  });

  it("defaults the source and rejects unknown ones", () => {
    expect(join_waitlist_input_schema.parse({ email: "a@b.co" }).source).toBe("hero");
    const unknown_source = { email: "a@b.co", source: "x" };
    expect(join_waitlist_input_schema.safeParse(unknown_source).success).toBe(false);
  });

  it.each([[""], ["nope"], ["a@"], ["@b.co"], [`${"a".repeat(250)}@b.co`], [undefined], [42]])(
    "rejects %s",
    (email) => {
      expect(join_waitlist_input_schema.safeParse({ email }).success).toBe(false);
    }
  );
});

describe("ids and addresses", () => {
  it("the network id changes by day and never contains the address", () => {
    const id = ip_limit_id("203.0.113.9", DAY);
    expect(id).not.toContain("203.0.113.9");
    expect(id).not.toBe(ip_limit_id("203.0.113.9", YESTERDAY));
    expect(id).not.toBe(ip_limit_id("203.0.113.10", DAY));
  });

  it("the entry id never contains the email", () => {
    expect(entry_id("a@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("utc_day uses the UTC date", () => {
    expect(utc_day(Date.UTC(2026, 10, 2, 23, 59))).toBe("2026-11-02");
  });

  it("client_ip prefers Hosting's header, then the last forwarded hop, then the fallback", () => {
    expect(client_ip(" 1.1.1.1 ", "2.2.2.2, 3.3.3.3", "4.4.4.4")).toBe("1.1.1.1");
    expect(client_ip(undefined, "2.2.2.2, 3.3.3.3", "4.4.4.4")).toBe("3.3.3.3");
    expect(client_ip("", "", "4.4.4.4")).toBe("4.4.4.4");
    expect(client_ip(undefined, undefined, undefined)).toBe("unknown");
  });
});
