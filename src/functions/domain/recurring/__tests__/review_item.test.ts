import {
  MAX_DISMISSED_VENDOR_KEYS,
  MAX_ITEM_TRANSACTION_IDS,
  MAX_SUPPRESSED_TXN_IDS,
  ReviewItem,
  apply_review_state_change,
  build_review_item_id,
  changed_items,
  is_vendor_dismissed,
  make_review_item,
  owner_of_review_item_id,
  resolve_review_item,
  suggested_subject,
  utc_day,
} from "../review_item.service";

const parts = (o: Partial<ReviewItem> = {}) => ({
  user_id: "u1", kind: "suggested" as const, direction: "outflow" as const, source: "plaid" as const,
  status: "open" as const, answer: null, subject_key: suggested_subject("outflow", "paypal /inst xfer"),
  vendor_key: "paypal /inst xfer", account_id: "a1", plaid_item_doc_id: "i1", stream_id: "s1", record_id: null,
  name: "PayPal", amount: 10, frequency: "monthly", plaid_status: "EARLY_DETECTION", category: null,
  transaction_ids: ["p1", "p2"], next_due_ms: null, user_frequency: null, resolved_at_ms: null, ...o,
});

describe("review_item", () => {
  it("ids are deterministic, owner-prefixed and safe for vendor keys with '/'", () => {
    const id = build_review_item_id("u1", "suggested", "outflow:paypal /inst xfer");
    expect(id).toBe(build_review_item_id("u1", "suggested", "outflow:paypal /inst xfer"));
    expect(id.startsWith("u1__suggested__")).toBe(true);
    expect(id).not.toContain("/");
    expect(owner_of_review_item_id(id)).toBe("u1");
    expect(build_review_item_id("u2", "suggested", "outflow:paypal /inst xfer")).not.toBe(id);
    expect(build_review_item_id("u1", "suggested", "inflow:paypal /inst xfer")).not.toBe(id);
  });

  it("only changed content is written (R5)", () => {
    const a = make_review_item(parts(), 1000);
    const again = make_review_item(parts(), 2000, a);
    expect(again.content_hash).toBe(a.content_hash);
    expect(changed_items([again], new Map([[a.id, a]]))).toEqual([]);
    const moved = make_review_item(parts({ amount: 11 }), 3000, a);
    expect(changed_items([moved], new Map([[a.id, a]]))).toHaveLength(1);
    expect(moved.created_at_ms).toBe(1000);
  });

  it("transaction ids on an item are bounded", () => {
    const many = Array.from({ length: 200 }, (_, i) => `p${i}`);
    expect(make_review_item(parts({ transaction_ids: many }), 1).transaction_ids).toHaveLength(MAX_ITEM_TRANSACTION_IDS);
  });

  it("answers: not_bill → dismissed; others → resolved", () => {
    const a = make_review_item(parts(), 1);
    expect(resolve_review_item(a, "not_bill", 5).status).toBe("dismissed");
    const t = resolve_review_item(a, "track", 5, { user_frequency: "monthly" });
    expect([t.status, t.answer, t.user_frequency, t.resolved_at_ms]).toEqual(["resolved", "track", "monthly", 5]);
  });

  it("state changes: suppressed / dismissed / throttle; writes only on change; bounded", () => {
    const s1 = apply_review_state_change(null, "u1", { add_suppressed: ["p1", "p2"] });
    expect(s1.changed && s1.suppressed_changed).toBe(true);
    const s2 = apply_review_state_change(s1.next, "u1", { add_suppressed: ["p2", "p1"] });
    expect([s2.changed, s2.suppressed_changed]).toEqual([false, false]);
    const s3 = apply_review_state_change(s2.next, "u1", { add_dismissed_vendor_keys: ["outflow:avant"] });
    expect([s3.changed, s3.suppressed_changed]).toEqual([true, false]);
    expect(is_vendor_dismissed(s3.next, "outflow", "avant")).toBe(true);
    expect(is_vendor_dismissed(s3.next, "inflow", "avant")).toBe(false);
    const s4 = apply_review_state_change(s3.next, "u1", { remove_suppressed: ["p1"] });
    expect(s4.suppressed_changed).toBe(true);
    expect(s4.next.suppressed_txn_ids).toEqual(["p2"]);
    const s5 = apply_review_state_change(s4.next, "u1", { detector_last_run_day: "2026-10-15" });
    expect([s5.changed, s5.suppressed_changed]).toEqual([true, false]);
    // An empty brand-new state isn't written.
    expect(apply_review_state_change(null, "u1", {}).changed).toBe(false);
    const big = apply_review_state_change(null, "u1", {
      add_suppressed: Array.from({ length: MAX_SUPPRESSED_TXN_IDS + 10 }, (_, i) => `p${i}`),
      add_dismissed_vendor_keys: Array.from({ length: MAX_DISMISSED_VENDOR_KEYS + 5 }, (_, i) => `outflow:v${i}`),
    });
    expect(big.next.suppressed_txn_ids).toHaveLength(MAX_SUPPRESSED_TXN_IDS);
    // Deterministic cap (defect 6): sorted, the first MAX kept — never insertion order.
    const all_ids = Array.from({ length: MAX_SUPPRESSED_TXN_IDS + 10 }, (_, i) => `p${i}`);
    expect(big.next.suppressed_txn_ids).toEqual([...all_ids].sort().slice(0, MAX_SUPPRESSED_TXN_IDS));
    expect(big.next.dismissed_vendor_keys).toHaveLength(MAX_DISMISSED_VENDOR_KEYS);
  });

  it("defect 6: the held-out cap is deterministic — identical input never changes the state", () => {
    for (const n of [MAX_SUPPRESSED_TXN_IDS - 1, MAX_SUPPRESSED_TXN_IDS, MAX_SUPPRESSED_TXN_IDS + 1, MAX_SUPPRESSED_TXN_IDS + 700]) {
      const ids = Array.from({ length: n }, (_, i) => `plaid_${(i * 7919) % 100003}_${i}`);
      const shuffled = [...ids].reverse();
      const r1 = apply_review_state_change(null, "u1", { add_suppressed: ids });
      expect(r1.next.suppressed_txn_ids.length).toBe(Math.min(n, MAX_SUPPRESSED_TXN_IDS));
      // The same ids again, in any order (the evicted ones included): no change at all.
      let state = r1.next;
      for (let k = 0; k < 5; k++) {
        const r = apply_review_state_change(state, "u1", { add_suppressed: k % 2 ? ids : shuffled });
        expect([r.changed, r.suppressed_changed]).toEqual([false, false]);
        state = r.next;
      }
      // Built in a different order from scratch → the identical stored set.
      expect(apply_review_state_change(null, "u1", { add_suppressed: shuffled }).next.suppressed_txn_ids)
        .toEqual(r1.next.suppressed_txn_ids);
      // The capped doc stays far under 1 MB.
      const bytes = Buffer.byteLength(JSON.stringify({
        suppressedTxnIds: state.suppressed_txn_ids, dismissedVendorKeys: Array.from({ length: MAX_DISMISSED_VENDOR_KEYS }, (_, i) => `outflow:${"v".repeat(60)}${i}`),
      }));
      expect(bytes).toBeLessThan(1024 * 1024);
    }
  });

  it("utc_day", () => {
    expect(utc_day(Date.UTC(2026, 9, 15, 23, 59))).toBe("2026-10-15");
  });
});
