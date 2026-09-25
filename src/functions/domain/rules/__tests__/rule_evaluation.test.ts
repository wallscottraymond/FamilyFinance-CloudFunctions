/**
 * evaluate_rules — Unit Tests (PURE, no emulator).
 *
 * Pins the Rules Engine's matching + intent-resolution semantics: every variable × operator,
 * AND/OR + nested groups, all-matching-apply, priority last-wins (scalars) / OR (booleans),
 * absolute-amount comparison, case-insensitive merchant (both name fields), and the make-recurring
 * side-effect intent. Locked design: 1 Projects/Transaction-Rules-Engine.md.
 */

import { evaluate_rules } from "../rule_evaluation.service";
import {
  Rule,
  RuleActions,
  RuleConditionGroup,
  RuleEvaluableTransaction,
} from "../../../types/rules.types";

/** A transaction with sensible defaults (overridable per test). */
function txn(over: Partial<RuleEvaluableTransaction> = {}): RuleEvaluableTransaction {
  return {
    merchant_name: "Blue Bottle Coffee",
    name: "SQ *BLUE BOTTLE #123",
    amount: 42.5, // Plaid: positive = money out
    transaction_date: new Date(Date.UTC(2026, 8, 15)), // 2026-09-15
    account_id: "acct_checking",
    plaid_primary_category: "FOOD_AND_DRINK",
    internal_primary_category: null,
    ...over,
  };
}

/** A rule with one AND group + given actions (overridable). */
function rule(
  id: string,
  conditions: RuleConditionGroup,
  actions: RuleActions,
  over: Partial<Rule> = {}
): Rule {
  return {
    id,
    user_id: "u1",
    name: id,
    conditions,
    actions,
    priority: 100,
    is_active: true,
    ...over,
  };
}

const AND = (...conditions: RuleConditionGroup["conditions"]): RuleConditionGroup => ({
  op: "AND",
  conditions,
});
const OR = (...conditions: RuleConditionGroup["conditions"]): RuleConditionGroup => ({
  op: "OR",
  conditions,
});

describe("evaluate_rules — variables & operators", () => {
  it("merchant contains matches the cleaned merchant_name (case-insensitive)", () => {
    const r = rule("r", AND({ variable: "merchant", operator: "contains", value: "blue bottle" }), {
      mark_income: true,
    });
    expect(evaluate_rules(txn(), [r]).applied_rule_ids).toEqual(["r"]);
  });

  it("merchant contains also matches the RAW name when merchant_name is empty", () => {
    const r = rule("r", AND({ variable: "merchant", operator: "contains", value: "blue bottle" }), {
      mark_income: true,
    });
    const t = txn({ merchant_name: "", name: "SQ *BLUE BOTTLE #9" });
    expect(evaluate_rules(t, [r]).applied_rule_ids).toEqual(["r"]);
  });

  it("merchant equals is exact (case-insensitive, trimmed)", () => {
    const hit = rule("hit", AND({ variable: "merchant", operator: "equals", value: "blue bottle coffee" }), {});
    const miss = rule("miss", AND({ variable: "merchant", operator: "equals", value: "blue bottle" }), {});
    expect(evaluate_rules(txn(), [hit]).applied_rule_ids).toEqual(["hit"]);
    // "equals" against merchant_name only-exact; raw name isn't an exact match either → miss
    expect(evaluate_rules(txn(), [miss]).applied_rule_ids).toEqual([]);
  });

  it("category equals uses internal category when set, else plaid", () => {
    const r = rule("r", AND({ variable: "category", operator: "equals", value: "groceries" }), {});
    expect(evaluate_rules(txn({ internal_primary_category: "Groceries" }), [r]).applied_rule_ids).toEqual(["r"]);
    expect(evaluate_rules(txn({ internal_primary_category: null, plaid_primary_category: "GROCERIES" }), [r]).applied_rule_ids).toEqual(["r"]);
    expect(evaluate_rules(txn(), [r]).applied_rule_ids).toEqual([]); // FOOD_AND_DRINK
  });

  it("account equals matches the account id", () => {
    const r = rule("r", AND({ variable: "account", operator: "equals", value: "acct_checking" }), {});
    expect(evaluate_rules(txn(), [r]).applied_rule_ids).toEqual(["r"]);
    expect(evaluate_rules(txn({ account_id: "acct_savings" }), [r]).applied_rule_ids).toEqual([]);
  });

  it("amount comparisons run on the ABSOLUTE amount (negative Plaid amount matches a positive threshold)", () => {
    const gt = rule("gt", AND({ variable: "amount", operator: "gt", value: 100 }), {});
    const income = txn({ amount: -250 }); // money in
    expect(evaluate_rules(income, [gt]).applied_rule_ids).toEqual(["gt"]); // abs(250) > 100
  });

  it("amount operators lt/lte/eq/gte/gt", () => {
    const t = txn({ amount: 50 });
    const mk = (operator: string) => rule(operator, AND({ variable: "amount", operator: operator as never, value: 50 }), {});
    expect(evaluate_rules(t, [mk("lt")]).applied_rule_ids).toEqual([]);
    expect(evaluate_rules(t, [mk("lte")]).applied_rule_ids).toEqual(["lte"]);
    expect(evaluate_rules(t, [mk("eq")]).applied_rule_ids).toEqual(["eq"]);
    expect(evaluate_rules(t, [mk("gte")]).applied_rule_ids).toEqual(["gte"]);
    expect(evaluate_rules(t, [mk("gt")]).applied_rule_ids).toEqual([]);
  });

  it("amount between is inclusive and order-independent", () => {
    const r = rule("r", AND({ variable: "amount", operator: "between", value: 100, value2: 40 }), {});
    expect(evaluate_rules(txn({ amount: 42.5 }), [r]).applied_rule_ids).toEqual(["r"]);
    expect(evaluate_rules(txn({ amount: 40 }), [r]).applied_rule_ids).toEqual(["r"]); // inclusive lo
    expect(evaluate_rules(txn({ amount: 100 }), [r]).applied_rule_ids).toEqual(["r"]); // inclusive hi
    expect(evaluate_rules(txn({ amount: 39.99 }), [r]).applied_rule_ids).toEqual([]);
  });

  it("date operators before/after/on/up_to (UTC calendar day)", () => {
    const on915 = { value: "2026-09-15" };
    const before = rule("before", AND({ variable: "date", operator: "before", ...on915 }), {});
    const after = rule("after", AND({ variable: "date", operator: "after", ...on915 }), {});
    const on = rule("on", AND({ variable: "date", operator: "on", ...on915 }), {});
    const up_to = rule("up_to", AND({ variable: "date", operator: "up_to", ...on915 }), {});
    const t = txn({ transaction_date: new Date(Date.UTC(2026, 8, 15)) }); // 09-15
    expect(evaluate_rules(t, [before]).applied_rule_ids).toEqual([]);
    expect(evaluate_rules(t, [after]).applied_rule_ids).toEqual([]);
    expect(evaluate_rules(t, [on]).applied_rule_ids).toEqual(["on"]);
    expect(evaluate_rules(t, [up_to]).applied_rule_ids).toEqual(["up_to"]); // on-or-before
  });

  it("date between is inclusive (epoch-ms values also accepted)", () => {
    const r = rule("r", AND({
      variable: "date",
      operator: "between",
      value: Date.UTC(2026, 8, 1),
      value2: Date.UTC(2026, 8, 30),
    }), {});
    expect(evaluate_rules(txn({ transaction_date: new Date(Date.UTC(2026, 8, 15)) }), [r]).applied_rule_ids).toEqual(["r"]);
    expect(evaluate_rules(txn({ transaction_date: new Date(Date.UTC(2026, 9, 1)) }), [r]).applied_rule_ids).toEqual([]);
  });
});

describe("evaluate_rules — group logic", () => {
  it("AND requires all conditions", () => {
    const r = rule("r", AND(
      { variable: "merchant", operator: "contains", value: "blue bottle" },
      { variable: "amount", operator: "gt", value: 100 }
    ), {});
    expect(evaluate_rules(txn({ amount: 42.5 }), [r]).applied_rule_ids).toEqual([]); // amount fails
    expect(evaluate_rules(txn({ amount: 150 }), [r]).applied_rule_ids).toEqual(["r"]);
  });

  it("OR needs only one condition", () => {
    const r = rule("r", OR(
      { variable: "merchant", operator: "contains", value: "nope" },
      { variable: "amount", operator: "eq", value: 42.5 }
    ), {});
    expect(evaluate_rules(txn(), [r]).applied_rule_ids).toEqual(["r"]);
  });

  it("nested groups: (merchant OR merchant) AND amount", () => {
    const conditions: RuleConditionGroup = {
      op: "AND",
      conditions: [{ variable: "amount", operator: "gte", value: 40 }],
      nested: [
        OR(
          { variable: "merchant", operator: "contains", value: "chevron" },
          { variable: "merchant", operator: "contains", value: "blue bottle" }
        ),
      ],
    };
    const r = rule("r", conditions, {});
    expect(evaluate_rules(txn(), [r]).applied_rule_ids).toEqual(["r"]);
    expect(evaluate_rules(txn({ amount: 5 }), [r]).applied_rule_ids).toEqual([]); // amount fails
  });

  it("an empty group never matches (no accidental match-everything)", () => {
    const r = rule("r", { op: "AND", conditions: [] }, { mark_income: true });
    expect(evaluate_rules(txn(), [r]).applied_rule_ids).toEqual([]);
  });
});

describe("evaluate_rules — multi-rule resolution", () => {
  it("all matching rules apply; applied_rule_ids collects every match", () => {
    const a = rule("a", AND({ variable: "merchant", operator: "contains", value: "blue bottle" }), { assign_category: "Coffee" });
    const b = rule("b", AND({ variable: "amount", operator: "lt", value: 100 }), { require_review: true }, { priority: 200 });
    const out = evaluate_rules(txn(), [a, b]);
    expect(out.applied_rule_ids.sort()).toEqual(["a", "b"]);
    expect(out.assign_category).toBe("Coffee");
    expect(out.require_review).toBe(true);
  });

  it("priority: later-in-list (higher priority number) wins a scalar conflict", () => {
    const top = rule("top", AND({ variable: "amount", operator: "gt", value: 1 }), { assign_budget_id: "budget_top" }, { priority: 10 });
    const bottom = rule("bottom", AND({ variable: "amount", operator: "gt", value: 1 }), { assign_budget_id: "budget_bottom" }, { priority: 20 });
    // Pass in reverse to prove internal sort by priority (not input order).
    const out = evaluate_rules(txn(), [bottom, top]);
    expect(out.assign_budget_id).toBe("budget_bottom"); // bottom (prio 20) evaluated last → wins
  });

  it("boolean flags are OR-of-all matching rules", () => {
    const a = rule("a", AND({ variable: "amount", operator: "gt", value: 1 }), { ignore: true }, { priority: 1 });
    const b = rule("b", AND({ variable: "amount", operator: "gt", value: 1 }), { mark_refund: true }, { priority: 2 });
    const out = evaluate_rules(txn(), [a, b]);
    expect(out.ignore).toBe(true);
    expect(out.mark_refund).toBe(true);
  });

  it("inactive rules are skipped", () => {
    const r = rule("r", AND({ variable: "merchant", operator: "contains", value: "blue bottle" }), { mark_income: true }, { is_active: false });
    expect(evaluate_rules(txn(), [r]).applied_rule_ids).toEqual([]);
  });

  it("make_recurring is surfaced as an intent (side effect handled by the orchestrator)", () => {
    const r = rule("r", AND({ variable: "merchant", operator: "contains", value: "blue bottle" }), { make_recurring: "outflow" });
    expect(evaluate_rules(txn(), [r]).make_recurring).toBe("outflow");
  });

  it("no rules → empty intents", () => {
    expect(evaluate_rules(txn(), [])).toEqual({ applied_rule_ids: [] });
  });

  it("is deterministic — same input, same output", () => {
    const r = rule("r", AND({ variable: "amount", operator: "between", value: 40, value2: 100 }), { assign_category: "X" });
    expect(evaluate_rules(txn(), [r])).toEqual(evaluate_rules(txn(), [r]));
  });
});

describe("evaluate_rules — tags", () => {
  it("`has tag` matches when the txn already carries the tag", () => {
    const r = rule("r", AND({ variable: "tag", operator: "has", value: "tag_food" }), { ignore: true });
    expect(evaluate_rules(txn({ tags: ["tag_food"] }), [r]).applied_rule_ids).toEqual(["r"]);
  });

  it("`has tag` does NOT match a fresh txn with no tags", () => {
    const r = rule("r", AND({ variable: "tag", operator: "has", value: "tag_food" }), { ignore: true });
    expect(evaluate_rules(txn(), [r]).applied_rule_ids).toEqual([]);
  });

  it("`add tag` surfaces a deduped add_tag intent", () => {
    const r1 = rule("r1", AND({ variable: "merchant", operator: "contains", value: "blue" }), { add_tag: ["a", "b"] });
    const r2 = rule("r2", AND({ variable: "amount", operator: "gt", value: 1 }), { add_tag: ["b", "c"] }, { priority: 200 });
    expect(evaluate_rules(txn(), [r1, r2]).add_tag).toEqual(["a", "b", "c"]);
  });

  it("chains: an earlier rule's `add tag` is visible to a later rule's `has tag`", () => {
    const adder = rule("adder", AND({ variable: "merchant", operator: "contains", value: "blue" }), { add_tag: ["vip"] }, { priority: 10 });
    const reactor = rule("reactor", AND({ variable: "tag", operator: "has", value: "vip" }), { require_review: true }, { priority: 20 });
    const out = evaluate_rules(txn(), [reactor, adder]); // order-insensitive (sorted by priority)
    expect(out.applied_rule_ids).toEqual(["adder", "reactor"]);
    expect(out.require_review).toBe(true);
  });

  it("does NOT chain backwards: a lower-priority `add tag` is invisible to a higher-priority `has tag`", () => {
    const reactor = rule("reactor", AND({ variable: "tag", operator: "has", value: "vip" }), { require_review: true }, { priority: 10 });
    const adder = rule("adder", AND({ variable: "merchant", operator: "contains", value: "blue" }), { add_tag: ["vip"] }, { priority: 20 });
    const out = evaluate_rules(txn(), [reactor, adder]);
    expect(out.applied_rule_ids).toEqual(["adder"]); // only the adder fired
    expect(out.require_review).toBeUndefined();
  });
});
