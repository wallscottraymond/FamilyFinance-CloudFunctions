/**
 * validate_rule / count_conditions / has_any_action — Unit Tests (PURE).
 */

import {
  validate_rule,
  count_conditions,
  has_any_action,
} from "../rule_validation.service";
import { RuleActions, RuleConditionGroup } from "../../../types/rules.types";

const groupWith = (n: number): RuleConditionGroup => ({
  op: "AND",
  conditions: Array.from({ length: n }, () => ({
    variable: "merchant" as const,
    operator: "contains",
    value: "x",
  })),
});

describe("rule_validation", () => {
  it("count_conditions counts direct + nested conditions", () => {
    const g: RuleConditionGroup = {
      op: "AND",
      conditions: [{ variable: "amount", operator: "gt", value: 1 }],
      nested: [groupWith(2)],
    };
    expect(count_conditions(g)).toBe(3);
  });

  it("has_any_action detects a set action (and ignores false/empty)", () => {
    expect(has_any_action({ mark_income: true })).toBe(true);
    expect(has_any_action({ assign_category: "X" })).toBe(true);
    expect(has_any_action({ split: [{ percent: 50 }] })).toBe(true);
    expect(has_any_action({ ignore: false })).toBe(false);
    expect(has_any_action({ split: [] })).toBe(false);
    expect(has_any_action({} as RuleActions)).toBe(false);
  });

  it("validate_rule requires ≥1 condition AND ≥1 action", () => {
    expect(validate_rule(groupWith(1), { mark_income: true })).toEqual([]);
    expect(validate_rule(groupWith(0), { mark_income: true })).toEqual([
      "A rule must have at least one condition.",
    ]);
    expect(validate_rule(groupWith(1), {})).toEqual([
      "A rule must have at least one action.",
    ]);
    expect(validate_rule(groupWith(0), {}).length).toBe(2);
  });

  // Code-Health-Review A1-H1: reject split specs that can't be a real split when the rule is saved.
  describe("split specs", () => {
    const v = (split: RuleActions["split"]) => validate_rule(groupWith(1), { split });

    it("accepts valid percents and amounts", () => {
      expect(v([{ percent: 50 }, { percent: 50 }])).toEqual([]);
      expect(v([{ percent: 30 }, { amount: 12.5 }])).toEqual([]);
      expect(v([{ amount: 40 }])).toEqual([]);
    });

    it.each([
      ["a zero percent", [{ percent: 0 }]],
      ["a negative percent", [{ percent: -10 }]],
      ["a percent above 100", [{ percent: 101 }]],
      ["percents adding up to more than 100", [{ percent: 60 }, { percent: 50 }]],
      ["a zero amount", [{ amount: 0 }]],
      ["a negative amount", [{ amount: -5 }]],
      ["a spec with neither percent nor amount", [{ budget_id: "b1" }]],
      ["a spec with both percent and amount", [{ percent: 10, amount: 5 }]],
      ["a non-finite amount", [{ amount: Number.POSITIVE_INFINITY }]],
    ])("rejects %s", (_label, split) => {
      expect(v(split as RuleActions["split"]).length).toBeGreaterThan(0);
    });
  });
});

