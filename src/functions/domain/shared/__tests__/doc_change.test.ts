/**
 * doc_change — unit tests for the trigger change-guard.
 *
 * Safety invariant: `only_ignored_changed` returns true (→ caller skips) ONLY
 * when every differing key is in the ignore list. Any real field change → false.
 */
import {
  changed_keys,
  only_ignored_changed,
  PERIOD_SUMMARY_IGNORE_FIELDS,
} from "../doc_change.service";

describe("changed_keys", () => {
  it("returns only the keys whose values differ", () => {
    const before = { a: 1, b: 2, c: { x: 1 } };
    const after = { a: 1, b: 3, c: { x: 1 } };
    expect(changed_keys(before, after)).toEqual(["b"]);
  });

  it("detects added and removed keys", () => {
    expect(changed_keys({ a: 1 }, { a: 1, b: 2 })).toEqual(["b"]);
    expect(changed_keys({ a: 1, b: 2 }, { a: 1 })).toEqual(["b"]);
  });

  it("deep-compares nested objects/arrays", () => {
    expect(changed_keys({ a: [1, 2] }, { a: [1, 2] })).toEqual([]);
    expect(changed_keys({ a: [1, 2] }, { a: [1, 3] })).toEqual(["a"]);
  });
});

describe("only_ignored_changed", () => {
  const IG = PERIOD_SUMMARY_IGNORE_FIELDS;

  it("skips an updatedAt-only write", () => {
    const before = { totalAmountDue: 100, updatedAt: 1 };
    const after = { totalAmountDue: 100, updatedAt: 2 };
    expect(only_ignored_changed(before, after, IG)).toBe(true);
  });

  it("skips a membership-only write (accessibleBy/memberIds)", () => {
    const before = { totalAmountDue: 100, accessibleBy: ["u1"], memberIds: ["u1"], updatedAt: 1 };
    const after = { totalAmountDue: 100, accessibleBy: ["u1", "u2"], memberIds: ["u1", "u2"], updatedAt: 2 };
    expect(only_ignored_changed(before, after, IG)).toBe(true);
  });

  it("does NOT skip when a summary-relevant field changed", () => {
    const before = { totalAmountDue: 100, updatedAt: 1 };
    const after = { totalAmountDue: 250, updatedAt: 2 };
    expect(only_ignored_changed(before, after, IG)).toBe(false);
  });

  it("does NOT skip when paid status changed alongside updatedAt", () => {
    const before = { isFullyPaid: false, updatedAt: 1 };
    const after = { isFullyPaid: true, updatedAt: 2 };
    expect(only_ignored_changed(before, after, IG)).toBe(false);
  });

  it("treats a no-op write (nothing changed) as skippable", () => {
    const doc = { totalAmountDue: 100, updatedAt: 1 };
    expect(only_ignored_changed(doc, { ...doc }, IG)).toBe(true);
  });
});
