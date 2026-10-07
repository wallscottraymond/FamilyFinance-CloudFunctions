/**
 * Account placement unit tests (Account-Rooted-Sharing Phase 2.1).
 * Test IDs refer to Account-Rooted-Sharing-Tests.md §4.
 */

import {
  plan_share_account,
  placement_on_accept,
  plan_unshare_account,
  account_fingerprint,
  placements_released,
  requests_released,
  PlaceableAccount,
  SharePlanInput,
} from "../placement.service";
import { build_group, accept_join } from "../group.service";
import { Group } from "../../../types/sharing.types";

const NOW = 1_800_000_000_000;

const acct = (over: Partial<PlaceableAccount> = {}): PlaceableAccount => ({
  id: "jc-a",
  user_id: "alex",
  is_active: true,
  name: "Joint Checking",
  mask: "1234",
  institution_id: "ins_1",
  account_subtype: "checking",
  placement: null,
  ...over,
});

function group(members: string[]): Group {
  const g = build_group("g1", "The Walls", members[0], 0, NOW).entity!.group;
  return members.slice(1).reduce((acc, m) => accept_join(acc, m, 0, NOW).entity!.group, g);
}

let n = 0;
const input = (over: Partial<SharePlanInput> = {}): SharePlanInput => ({
  account: acct(),
  caller_id: "alex",
  group: group(["alex", "sam", "riley"]),
  include_history: false,
  group_accounts: [],
  pending_for_account: [],
  sent_today: [],
  now_ms: NOW,
  new_request_id: () => `r${++n}`,
  ...over,
});

describe("share an account (P1, D25)", () => {
  it("T-AP-01 group with others → a request to each other member; nothing shared yet", () => {
    const plan = plan_share_account(input()).entity!;
    expect(plan.placement).toBeNull();
    expect(plan.requests.map((r) => r.to_user_id)).toEqual(["sam", "riley"]);
    expect(plan.requests[0]).toMatchObject({
      type: "share_account",
      target_id: "jc-a",
      target_label: "Joint Checking ••1234",
      shared_from_ms: NOW,
    });
  });
  it("T-AP-02 group of one (Mom) → shared at once", () => {
    const plan = plan_share_account(input({ group: group(["alex"]) })).entity!;
    expect(plan.placement).toEqual({
      group_id: "g1", shared_from_ms: NOW, shared_by: "alex", shared_at_ms: NOW,
    });
    expect(plan.requests).toEqual([]);
  });
  it("N9 include history → shared_from null", () => {
    const plan = plan_share_account(input({ include_history: true })).entity!;
    expect(plan.requests[0].shared_from_ms).toBeNull();
  });
  it("T-AP-03 only the owner; only a member; one group per account (D7)", () => {
    expect(plan_share_account(input({ caller_id: "sam" })).validation_errors).toBeDefined();
    expect(plan_share_account(input({ group: group(["sam"]) })).validation_errors).toBeDefined();
    const shared = acct({
      placement: { group_id: "g2", shared_from_ms: null, shared_by: "alex", shared_at_ms: NOW },
    });
    expect(plan_share_account(input({ account: shared })).validation_errors?.[0])
      .toMatch(/another group/);
  });
  it("T-AP-05 I4 duplicate: the same real account already shared by someone else", () => {
    const sams_copy = acct({ id: "jc-s", user_id: "sam" });
    const r = plan_share_account(input({ group_accounts: [sams_copy] }));
    expect(r.validation_errors).toBeDefined();
    expect(r.entity!.duplicate_owner_id).toBe("sam");
    expect(account_fingerprint(acct({ mask: null }))).toBeNull();
  });
  it("no double request; daily limit counts the other members (D26)", () => {
    const pending = plan_share_account(input()).entity!.requests;
    expect(plan_share_account(input({ pending_for_account: pending })).validation_errors)
      .toBeDefined();
    const busy = ["a", "b", "c", "d"].map((to) => ({ to_user_id: to, created_at_ms: NOW }));
    expect(plan_share_account(input({ sent_today: busy })).validation_errors).toBeDefined();
  });
});

describe("accepting a share (PD5) and unsharing", () => {
  const req = () => plan_share_account(input()).entity!.requests[0];
  it("first accept → placement from the request", () => {
    const p = placement_on_accept(req(), acct(), group(["alex", "sam", "riley"]), NOW + 5);
    expect(p.entity).toEqual({
      group_id: "g1", shared_from_ms: NOW, shared_by: "alex", shared_at_ms: NOW + 5,
    });
  });
  it("second accept is a no-op success; changed account / group → refused", () => {
    const g = group(["alex", "sam", "riley"]);
    const placed = acct({
      placement: { group_id: "g1", shared_from_ms: NOW, shared_by: "alex", shared_at_ms: NOW },
    });
    expect(placement_on_accept(req(), placed, g, NOW).entity).toEqual(placed.placement);
    expect(placement_on_accept(req(), acct({ is_active: false }), g, NOW).validation_errors)
      .toBeDefined();
    expect(placement_on_accept(req(), acct(), group(["alex", "riley"]), NOW).validation_errors)
      .toBeDefined();
  });
  it("unshare: owner only, must be shared", () => {
    const placed = acct({
      placement: { group_id: "g1", shared_from_ms: NOW, shared_by: "alex", shared_at_ms: NOW },
    });
    expect(plan_unshare_account(placed, "alex").entity).toEqual({ was_group_id: "g1" });
    expect(plan_unshare_account(placed, "sam").validation_errors).toBeDefined();
    expect(plan_unshare_account(acct(), "alex").validation_errors).toBeDefined();
  });
});

describe("departures release accounts + requests (D13)", () => {
  const p = (gid: string) => ({ group_id: gid, shared_from_ms: null, shared_by: "x", shared_at_ms: NOW });
  const accounts = [
    acct({ id: "a1", user_id: "alex", placement: p("g1") }),
    acct({ id: "s1", user_id: "sam", placement: p("g1") }),
    acct({ id: "s2", user_id: "sam", placement: p("g2") }),
  ];
  it("T-LV-01 a leaver's accounts in THIS group go private; others stay", () => {
    expect(placements_released(accounts, "g1", ["sam"])).toEqual(["s1"]);
    expect(placements_released(accounts, "g1", "all")).toEqual(["a1", "s1"]);
  });
  it("requests from or to the leaver are released", () => {
    const base = plan_share_account(input()).entity!.requests; // alex → sam, alex → riley
    expect(requests_released(base, ["riley"]).map((r) => r.to_user_id)).toEqual(["riley"]);
    expect(requests_released(base, ["alex"])).toHaveLength(2);
    expect(requests_released(base, "all")).toHaveLength(2);
  });
});
