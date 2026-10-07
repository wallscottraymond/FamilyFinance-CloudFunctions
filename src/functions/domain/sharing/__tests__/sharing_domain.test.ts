/**
 * Sharing domain unit tests (Account-Rooted-Sharing Phase 1).
 * Test IDs refer to Account-Rooted-Sharing-Tests.md.
 */

import {
  generated_name,
  normalize_nickname,
  build_code,
  build_connect_code,
  normalize_entered_code,
  evaluate_code_entry,
  apply_failure,
  CODE_ALPHABET,
  CODE_TTL_MS,
  COOLDOWN_MS,
  MAX_CONNECTIONS,
  pair_id,
  build_connection,
  apply_connection_action,
  check_daily_recipient_limit,
  build_join_request,
  answer_request,
  build_report,
  REQUEST_TTL_MS,
  build_group,
  validate_invite,
  accept_join,
  leave_group,
  remove_member,
  transfer_ownership,
  rename_group,
  delete_group,
  build_sharing_overview,
} from "..";
import { ConnectCode, Group } from "../../../types/sharing.types";

const NOW = 1_800_000_000_000;

function code_doc(user_id: string, code: string, over: Partial<ConnectCode> = {}): ConnectCode {
  return { ...build_connect_code(user_id, code, NOW, null), ...over };
}

function group_with(owner: string, others: string[] = []): Group {
  const g = build_group("g1", "The Walls", owner, 0, NOW).entity!.group;
  return others.reduce((acc, uid) => accept_join(acc, uid, 0, NOW).entity!.group, g);
}

describe("generated names (D28)", () => {
  it("T-NM-01 same uid → same name; looks like 'Adjective Animal'", () => {
    expect(generated_name("abc")).toBe(generated_name("abc"));
    expect(generated_name("abc")).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });
  it("spreads uids across names", () => {
    const names = new Set(Array.from({ length: 200 }, (_, i) => generated_name(`user_${i}`)));
    expect(names.size).toBeGreaterThan(150);
  });
  it("nicknames: trimmed, empty clears, too long rejected", () => {
    expect(normalize_nickname("  Sam  ").nickname).toBe("Sam");
    expect(normalize_nickname("   ").nickname).toBeNull();
    expect(normalize_nickname("x".repeat(41)).error).toBeDefined();
  });
});

describe("connect codes (D24, D29)", () => {
  it("codes use only the unambiguous alphabet", () => {
    const code = build_code([0, 1, 2, 30, 31, 999]);
    expect(code).toHaveLength(6);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
  });
  it("normalizes typed codes and rejects impossible ones", () => {
    expect(normalize_entered_code("4f7 q2k")).toBe("4F7Q2K");
    expect(normalize_entered_code("4F7-Q2K")).toBe("4F7Q2K");
    expect(normalize_entered_code("4F7Q2")).toBeNull();
    expect(normalize_entered_code("40OQ2K")).toBeNull(); // 0 and O aren't used
  });

  const base = {
    caller_id: "alex",
    now_ms: NOW + 1000,
    caller_code: code_doc("alex", "AAAAAA"),
    existing_connection_status: null,
    caller_connection_count: 0,
    target_connection_count: 0,
  };

  it("T-CN-01 first person to type → waiting (entry recorded, no connection)", () => {
    const d = evaluate_code_entry({ ...base, target: code_doc("sam", "BBBBBB") });
    expect(d.outcome).toBe("waiting");
    expect(d.record_entry).toBe(true);
    expect(d.other_user_id).toBe("sam");
  });
  it("T-CN-02 second person types → connected", () => {
    const caller_code = code_doc("alex", "AAAAAA", { entries: { sam: NOW + 500 } });
    const d = evaluate_code_entry({ ...base, caller_code, target: code_doc("sam", "BBBBBB") });
    expect(d.outcome).toBe("connected");
  });
  it("T-CN-03 their entry older than the window → waiting again", () => {
    const caller_code = code_doc("alex", "AAAAAA", {
      entries: { sam: NOW - CODE_TTL_MS - 5000 },
    });
    const d = evaluate_code_entry({ ...base, caller_code, target: code_doc("sam", "BBBBBB") });
    expect(d.outcome).toBe("waiting");
  });
  it("T-CN-04 expired or unknown code → invalid + counts as a failure", () => {
    const expired = code_doc("sam", "BBBBBB", { expires_at_ms: NOW });
    expect(evaluate_code_entry({ ...base, target: expired }).outcome).toBe("invalid");
    const d = evaluate_code_entry({ ...base, target: null });
    expect(d.outcome).toBe("invalid");
    expect(d.record_failure).toBe(true);
  });
  it("T-CN-05 own code → self", () => {
    expect(evaluate_code_entry({ ...base, target: code_doc("alex", "AAAAAA") }).outcome)
      .toBe("self");
  });
  it("T-CN-06 5 wrong codes → 15-minute cooldown", () => {
    let state = { failed_attempts: 0, cooldown_until_ms: 0 };
    for (let i = 0; i < 5; i++) state = apply_failure(state.failed_attempts, NOW);
    expect(state.cooldown_until_ms).toBe(NOW + COOLDOWN_MS);
    const caller_code = code_doc("alex", "AAAAAA", { cooldown_until_ms: NOW + COOLDOWN_MS });
    const d = evaluate_code_entry({ ...base, caller_code, target: code_doc("sam", "BBBBBB") });
    expect(d.outcome).toBe("cooldown");
  });
  it("T-CN-07 blocked pair → generic unavailable; already connected → already_connected", () => {
    const target = code_doc("sam", "BBBBBB");
    expect(evaluate_code_entry({ ...base, target, existing_connection_status: "blocked" }).outcome)
      .toBe("unavailable");
    expect(
      evaluate_code_entry({ ...base, target, existing_connection_status: "connected" }).outcome
    ).toBe("already_connected");
  });
  it("T-CN-08 10 connections limit, checked for both people (D29)", () => {
    const target = code_doc("sam", "BBBBBB");
    expect(
      evaluate_code_entry({ ...base, target, caller_connection_count: MAX_CONNECTIONS }).outcome
    ).toBe("limit_self");
    expect(
      evaluate_code_entry({ ...base, target, target_connection_count: MAX_CONNECTIONS }).outcome
    ).toBe("limit_other");
  });
});

describe("connections (D27, D28)", () => {
  const c = build_connection("sam", "alex", NOW);
  it("pair id is order-independent", () => {
    expect(pair_id("a", "b")).toBe(pair_id("b", "a"));
    expect(c.user_ids).toEqual(["alex", "sam"]);
  });
  it("T-NM-03 nickname is per viewer", () => {
    const r = apply_connection_action(c, "alex", { action: "set_nickname", nickname: "Sam" });
    expect(r.entity!.connection!.nicknames).toEqual({ alex: "Sam" });
  });
  it("disconnect deletes; block keeps the doc and clears nicknames", () => {
    expect(apply_connection_action(c, "alex", { action: "disconnect" }).entity!.connection)
      .toBeNull();
    const blocked = apply_connection_action(c, "alex", { action: "block" }).entity!.connection!;
    expect(blocked.status).toBe("blocked");
    expect(blocked.blocked_by).toBe("alex");
    expect(apply_connection_action(blocked, "sam", { action: "disconnect" }).validation_errors)
      .toBeDefined();
  });
  it("strangers can't act on a connection", () => {
    expect(apply_connection_action(c, "riley", { action: "block" }).validation_errors)
      .toBeDefined();
  });
});

describe("requests (D25, D26)", () => {
  it("T-CN-15 5 distinct recipients per 24h; repeats don't count twice", () => {
    const recent = ["a", "b", "c", "d"].map((to) => ({ to_user_id: to, created_at_ms: NOW - 1000 }));
    expect(check_daily_recipient_limit(recent, ["e"], NOW)).toEqual([]);
    expect(check_daily_recipient_limit(recent, ["a"], NOW)).toEqual([]);
    expect(check_daily_recipient_limit(recent, ["e", "f"], NOW)).toHaveLength(1);
    const old = recent.map((r) => ({ ...r, created_at_ms: NOW - 25 * 3600 * 1000 }));
    expect(check_daily_recipient_limit(old, ["e", "f"], NOW)).toEqual([]);
  });
  it("only the recipient answers, only while open", () => {
    const r = build_join_request("r1", "alex", "sam", "g1", NOW);
    expect(answer_request(r, "riley", true, NOW).validation_errors).toBeDefined();
    expect(answer_request(r, "sam", true, NOW).entity!.status).toBe("accepted");
    expect(answer_request(r, "sam", false, NOW).entity!.status).toBe("declined");
    expect(answer_request(r, "sam", true, NOW + REQUEST_TTL_MS).validation_errors).toBeDefined();
  });
  it("reports: no self-reports, reason bounded", () => {
    expect(build_report("x", "a", "a", "", NOW).validation_errors).toBeDefined();
    expect(build_report("x", "a", "b", "y".repeat(501), NOW).validation_errors).toBeDefined();
    expect(build_report("x", "a", "b", " spam ", NOW).entity!.reason).toBe("spam");
  });
});

describe("groups (D4, D30)", () => {
  it("T-SP-01 create: creator is owner; name validated", () => {
    const m = build_group("g1", "  The   Walls ", "alex", 0, NOW).entity!;
    expect(m.group.name).toBe("The Walls");
    expect(m.group.members.alex.role).toBe("owner");
    expect(m.user_changes).toEqual([{ user_id: "alex", add: "g1" }]);
    expect(build_group("g1", " ", "alex", 0, NOW).validation_errors).toBeDefined();
  });
  it("T-SP-03 3-group limit on create AND on accept", () => {
    expect(build_group("g4", "Fourth", "alex", 3, NOW).validation_errors).toBeDefined();
    const g = group_with("alex");
    expect(accept_join(g, "sam", 3, NOW).validation_errors).toBeDefined();
    expect(accept_join(g, "sam", 2, NOW).entity!.group.members.sam.role).toBe("full");
  });
  it("invites need a connection and a member inviter", () => {
    const g = group_with("alex");
    expect(validate_invite(g, "alex", "sam", true)).toEqual([]);
    expect(validate_invite(g, "alex", "sam", false)).toHaveLength(1);
    expect(validate_invite(g, "riley", "sam", true)).toHaveLength(1);
    expect(validate_invite(group_with("alex", ["sam"]), "alex", "sam", true)).toHaveLength(1);
  });
  it("owner can't leave while others remain; sole owner leaving deletes", () => {
    const g = group_with("alex", ["sam"]);
    expect(leave_group(g, "alex", NOW).validation_errors).toBeDefined();
    const sam_leaves = leave_group(g, "sam", NOW).entity!;
    expect(sam_leaves.group.member_ids).toEqual(["alex"]);
    expect(sam_leaves.user_changes).toEqual([{ user_id: "sam", remove: "g1" }]);
    const solo = leave_group(group_with("alex"), "alex", NOW).entity!;
    expect(solo.group.deleted_at_ms).toBe(NOW);
  });
  it("only the owner removes, transfers, deletes; any member renames", () => {
    const g = group_with("alex", ["sam"]);
    expect(remove_member(g, "sam", "alex").validation_errors).toBeDefined();
    expect(remove_member(g, "alex", "sam").entity!.group.member_ids).toEqual(["alex"]);
    const t = transfer_ownership(g, "alex", "sam").entity!.group;
    expect(t.owner_id).toBe("sam");
    expect(t.members.alex.role).toBe("full");
    expect(delete_group(g, "sam", NOW).validation_errors).toBeDefined();
    const d = delete_group(g, "alex", NOW).entity!;
    expect(d.user_changes.map((c) => c.user_id).sort()).toEqual(["alex", "sam"]);
    expect(rename_group(g, "sam", "Walls").entity!.group.name).toBe("Walls");
  });
});

describe("overview (Groups screen)", () => {
  it("renders people per viewer and hides closed requests", () => {
    const g = group_with("alex", ["sam"]);
    const conn = apply_connection_action(build_connection("alex", "sam", NOW), "alex", {
      action: "set_nickname",
      nickname: "Sam",
    }).entity!.connection!;
    const kids: Group = { ...group_with("jordan"), id: "g2", name: "Kids" };
    const open = build_join_request("r1", "jordan", "alex", "g2", NOW);
    const closed = { ...build_join_request("r2", "jordan", "alex", "g2", NOW), status: "declined" as const };
    const o = build_sharing_overview("alex", [conn], [g], [open, closed], { g2: kids }, NOW + 1);
    expect(o.groups[0].members.map((m) => m.person.nickname)).toEqual([null, "Sam"]);
    expect(o.connections[0].shared_group_names).toEqual(["The Walls"]);
    expect(o.requests.map((r) => r.id)).toEqual(["r1"]);
    expect(o.requests[0].from.nickname).toBeNull();
    expect(o.group_limit).toBe(3);
    expect(JSON.stringify(o)).not.toMatch(/@/);
  });
});
