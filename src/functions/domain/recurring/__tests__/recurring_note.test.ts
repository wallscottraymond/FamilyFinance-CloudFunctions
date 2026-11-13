import {
  normalize_note,
  NOTE_MAX,
  period_belongs_to,
  period_recurring_id,
  pick_definition_fields,
  to_client,
} from "../recurring_note.service";

describe("recurring_note", () => {
  it("shares only the detail screen's definition fields", () => {
    const raw = { merchantName: "Xfinity", averageAmount: 89.99, transactionIds: ["t1"], userId: "u1" };
    expect(pick_definition_fields("outflow", raw)).toEqual({ merchantName: "Xfinity", averageAmount: 89.99 });
    expect(pick_definition_fields("inflow", { incomeNote: "hi", ownerId: "u1" })).toEqual({ incomeNote: "hi" });
  });

  it("a period reaches only its own bill / income", () => {
    expect(period_recurring_id("outflow", { outflowId: "o1" })).toBe("o1");
    expect(period_recurring_id("inflow", { outflowId: "o1" })).toBeNull();
    expect(period_belongs_to("outflow", { outflowId: "o1" }, "o1")).toBe(true);
    expect(period_belongs_to("outflow", { outflowId: "o1" }, "o2")).toBe(false);
  });

  it("timestamps go out as { __ts: ms }, deeply", () => {
    const ts = { toMillis: () => 123 };
    expect(to_client({ a: ts, b: [ts, { c: ts }], d: "x", e: null })).toEqual({
      a: { __ts: 123 }, b: [{ __ts: 123 }, { c: { __ts: 123 } }], d: "x", e: null,
    });
  });

  it("notes are trimmed; empty clears; too long is refused", () => {
    expect(normalize_note("  Autopay  ").entity).toBe("Autopay");
    expect(normalize_note("   ").entity).toBe("");
    expect(normalize_note("x".repeat(NOTE_MAX + 1)).validation_errors).toBeDefined();
  });
});
