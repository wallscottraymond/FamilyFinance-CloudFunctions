/**
 * Derive scope unit tests (Account-Rooted-Sharing Phase 3; Tests §5 T-DV-*).
 */

import {
  build_me_scope,
  build_group_scope,
  account_in_scope,
  transaction_in_scope,
} from "../derive_scope.service";

const DAY = 86_400_000;
const SHARE_DAY = 1_790_000_000_000;

describe("Me scope (D5)", () => {
  const me = build_me_scope("alex", [{ doc_id: "jc_doc", plaid_account_id: "jc_plaid" }]);
  it("T-DV-01 nothing shared → everything counts (parity)", () => {
    const none = build_me_scope("alex", []);
    for (const id of ["a", "jc_plaid", "", null, undefined]) {
      expect(account_in_scope(none, id)).toBe(true);
      expect(transaction_in_scope(none, id, 0)).toBe(true);
    }
    expect(none.budget_owner_key).toBe("alex");
    expect(none.member_ids).toEqual(["alex"]);
  });
  it("T-DV-02 a shared account leaves Me (by doc id AND Plaid id)", () => {
    expect(account_in_scope(me, "jc_doc")).toBe(false);
    expect(account_in_scope(me, "jc_plaid")).toBe(false);
    expect(transaction_in_scope(me, "jc_plaid", SHARE_DAY + DAY)).toBe(false);
  });
  it("items with no account / unknown account stay in Me", () => {
    expect(account_in_scope(me, null)).toBe(true);
    expect(account_in_scope(me, "")).toBe(true);
    expect(account_in_scope(me, "visa_plaid")).toBe(true);
  });
});

describe("Group scope (D2, N9, guard)", () => {
  const g = build_group_scope("g1", ["alex", "sam"], [
    { doc_id: "jc_doc", plaid_account_id: "jc_plaid", owner_id: "alex", shared_from_ms: SHARE_DAY },
    { doc_id: "amex_doc", plaid_account_id: "amex_plaid", owner_id: "sam", shared_from_ms: null },
    { doc_id: "gone_doc", plaid_account_id: "gone_plaid", owner_id: "riley", shared_from_ms: null },
  ]);
  it("T-DV-03 only shared accounts count; everything else is out (allow-list)", () => {
    expect(account_in_scope(g, "jc_plaid")).toBe(true);
    expect(account_in_scope(g, "amex_doc")).toBe(true);
    expect(account_in_scope(g, "visa_plaid")).toBe(false);
    expect(account_in_scope(g, null)).toBe(false);
    expect(account_in_scope(g, "")).toBe(false);
  });
  it("T-DV-05 N9 share-from: earlier transactions stay private; all-history counts all", () => {
    expect(transaction_in_scope(g, "jc_plaid", SHARE_DAY - 1)).toBe(false);
    expect(transaction_in_scope(g, "jc_plaid", SHARE_DAY)).toBe(true);
    expect(transaction_in_scope(g, "jc_doc", SHARE_DAY + DAY)).toBe(true);
    expect(transaction_in_scope(g, "amex_plaid", 0)).toBe(true);
  });
  it("T-DV-07 guard: an account whose owner isn't a member never counts", () => {
    expect(account_in_scope(g, "gone_plaid")).toBe(false);
    expect(transaction_in_scope(g, "gone_doc", SHARE_DAY)).toBe(false);
  });
  it("owner key + members", () => {
    expect(g.budget_owner_key).toBe("group:g1");
    expect(g.member_ids.sort()).toEqual(["alex", "sam"]);
  });
});

describe("one place per account (P1)", () => {
  it("T-P-01 an account is in exactly one of Me / its group", () => {
    const shared = [{ doc_id: "jc_doc", plaid_account_id: "jc_plaid" }];
    const me = build_me_scope("alex", shared);
    const g = build_group_scope("g1", ["alex", "sam"], [
      { ...shared[0], owner_id: "alex", shared_from_ms: null },
    ]);
    for (const id of ["jc_doc", "jc_plaid", "visa_plaid"]) {
      expect(Number(account_in_scope(me, id)) + Number(account_in_scope(g, id))).toBe(1);
    }
  });
});
