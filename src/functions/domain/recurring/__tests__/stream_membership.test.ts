/**
 * build_stream_membership_map — Unit Tests
 *
 * The `txn id → recurring id` map with the CONFLICT rule: an id claimed by two streams
 * is excluded (no arbitrary last-writer-wins guess).
 */

import { build_stream_membership_map } from "../stream_membership";

describe("build_stream_membership_map", () => {
  it("maps each transaction id to its single owning stream", () => {
    const map = build_stream_membership_map([
      { id: "billA", transaction_ids: ["t1", "t2"] },
      { id: "billB", transaction_ids: ["t3"] },
    ]);
    expect(map.get("t1")).toBe("billA");
    expect(map.get("t2")).toBe("billA");
    expect(map.get("t3")).toBe("billB");
    expect(map.size).toBe(3);
  });

  it("EXCLUDES an id claimed by two different streams (no guess), regardless of order", () => {
    const forward = build_stream_membership_map([
      { id: "capOne", transaction_ids: ["shared", "c1"] },
      { id: "sofi", transaction_ids: ["shared", "s1"] },
    ]);
    const reversed = build_stream_membership_map([
      { id: "sofi", transaction_ids: ["shared", "s1"] },
      { id: "capOne", transaction_ids: ["shared", "c1"] },
    ]);
    expect(forward.has("shared")).toBe(false); // ambiguous → dropped
    expect(reversed.has("shared")).toBe(false); // same result either order (deterministic)
    // Non-conflicting ids still map.
    expect(forward.get("c1")).toBe("capOne");
    expect(forward.get("s1")).toBe("sofi");
  });

  it("tolerates missing/empty transaction_ids", () => {
    const map = build_stream_membership_map([
      { id: "a", transaction_ids: null },
      { id: "b" },
      { id: "c", transaction_ids: [] },
    ]);
    expect(map.size).toBe(0);
  });

  it("a duplicate id within the SAME stream is not a conflict", () => {
    const map = build_stream_membership_map([{ id: "a", transaction_ids: ["t1", "t1"] }]);
    expect(map.get("t1")).toBe("a");
  });
});
