/**
 * internal_transfer domain service — unit tests.
 * Internal = matched OUT/IN of same amount on different accounts within tolerance.
 * External (unpaired) transfers — e.g. an ACH mortgage payment — stay external.
 */

import {
  detect_internal_transfers,
  TransferForPairing,
} from "../internal_transfer.service";

const day = (d: number) => Date.UTC(2026, 6, d);

function t(over: Partial<TransferForPairing> = {}): TransferForPairing {
  return {
    id: "x",
    plaid_id: "px",
    account_id: "A",
    amount: 500,
    date_ms: day(10),
    direction: "out",
    ...over,
  };
}

describe("detect_internal_transfers", () => {
  it("pairs an OUT with a matching IN on a different account → both internal", () => {
    const r = detect_internal_transfers([
      t({ id: "o1", plaid_id: "po1", account_id: "A", direction: "out", amount: 500, date_ms: day(10) }),
      t({ id: "i1", plaid_id: "pi1", account_id: "B", direction: "in", amount: 500, date_ms: day(11) }),
    ]);
    expect(r.internal_ids.has("o1")).toBe(true);
    expect(r.internal_ids.has("i1")).toBe(true);
    expect(r.internal_plaid_ids.has("po1")).toBe(true);
  });

  it("an unpaired OUT (external ACH bill) is NOT internal", () => {
    const r = detect_internal_transfers([
      t({ id: "mortgage", account_id: "A", direction: "out", amount: 2000, date_ms: day(1) }),
      t({ id: "i1", account_id: "B", direction: "in", amount: 500, date_ms: day(1) }), // different amount
    ]);
    expect(r.internal_ids.has("mortgage")).toBe(false);
  });

  it("does NOT pair same-account OUT/IN", () => {
    const r = detect_internal_transfers([
      t({ id: "o1", account_id: "A", direction: "out", amount: 500, date_ms: day(10) }),
      t({ id: "i1", account_id: "A", direction: "in", amount: 500, date_ms: day(10) }),
    ]);
    expect(r.internal_ids.size).toBe(0);
  });

  it("respects the date tolerance", () => {
    const r = detect_internal_transfers([
      t({ id: "o1", account_id: "A", direction: "out", amount: 500, date_ms: day(1) }),
      t({ id: "i1", account_id: "B", direction: "in", amount: 500, date_ms: day(20) }), // 19d apart
    ]);
    expect(r.internal_ids.size).toBe(0);
  });

  it("each IN is consumed once (two OUTs, one IN → only one pair)", () => {
    const r = detect_internal_transfers([
      t({ id: "o1", account_id: "A", direction: "out", amount: 500, date_ms: day(10) }),
      t({ id: "o2", account_id: "A", direction: "out", amount: 500, date_ms: day(10) }),
      t({ id: "i1", account_id: "B", direction: "in", amount: 500, date_ms: day(10) }),
    ]);
    // one OUT pairs; the other stays external
    expect([r.internal_ids.has("o1"), r.internal_ids.has("o2")].filter(Boolean).length).toBe(1);
    expect(r.internal_ids.has("i1")).toBe(true);
  });
});
