/**
 * Rule evaluation — PURE domain service (no IO, deterministic).
 *
 * `evaluate_rules(txn, rules)` returns the resolved `RuleActionIntents` for one transaction after
 * applying EVERY matching rule in priority order. The algorithmic heart of the Rules Engine;
 * it is called once per transaction against the batch's already-loaded rules (rules are loaded once
 * per sync batch — never per-txn — see the project's Read-Cost Plan).
 *
 * Semantics (locked in Transaction-Rules-Engine.md):
 * - ALL matching rules apply (not first-match-stop).
 * - Priority = the rule's `priority` (list order). Lower number = higher in the list
 *   = evaluated earlier; a LATER-evaluated rule OVERRIDES an earlier one on the same scalar field.
 *   Boolean flags are OR-of-all (any matching rule turns them on).
 * - Conditions combine via a flat AND/OR group (v1); `nested` groups recurse so the
 *   schema is nesting-ready. Short-circuit evaluation (AND stops on first false, OR on first true).
 * - `make_recurring` is returned as an intent, NOT applied inline (the orchestrator does that
 *   side effect around the write).
 * - No `Date.now()` / relative dates → evaluation is pure and unit-testable without mocks.
 */

import {
  ConditionOperator,
  Rule,
  RuleActionIntents,
  RuleActions,
  RuleCondition,
  RuleConditionGroup,
  RuleEvaluableTransaction,
  RuleVariable,
} from "../../types/rules.types";

/**
 * Evaluate all rules against one transaction; return the merged action intents.
 * `rules` need not be pre-sorted — they are sorted by `priority` here for determinism.
 */
export function evaluate_rules(
  txn: RuleEvaluableTransaction,
  rules: Rule[]
): RuleActionIntents {
  const intents: RuleActionIntents = { applied_rule_ids: [] };

  // Running view of the txn whose `tags` grows as `add tag` rules fire, so a later rule's
  // `has tag` can match a tag an earlier (higher-priority) rule just added. Starts from the
  // txn's current tags (empty for a fresh Plaid txn at ingest).
  const running: RuleEvaluableTransaction = { ...txn, tags: [...(txn.tags ?? [])] };

  // Ascending priority = top of the Rule Book first; later (lower in the list) overrides earlier.
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of ordered) {
    if (!rule.is_active) continue;
    if (!evaluate_group(running, rule.conditions)) continue;
    intents.applied_rule_ids.push(rule.id);
    accumulate_actions(rule.actions, intents);
    // Reflect newly-added tags into the running view for subsequent rules' `has tag` conditions.
    if (rule.actions.add_tag && rule.actions.add_tag.length > 0) {
      const seen = new Set(running.tags ?? []);
      for (const id of rule.actions.add_tag) if (!seen.has(id)) (running.tags ??= []).push(id);
    }
  }

  return intents;
}

/** Merge one matched rule's actions into the running intents (scalars: last-wins; booleans: OR). */
function accumulate_actions(actions: RuleActions, intents: RuleActionIntents): void {
  if (actions.assign_budget_id !== undefined) intents.assign_budget_id = actions.assign_budget_id;
  if (actions.assign_category !== undefined) intents.assign_category = actions.assign_category;
  if (actions.split !== undefined) intents.split = actions.split;
  if (actions.make_recurring !== undefined) intents.make_recurring = actions.make_recurring;
  if (actions.ignore) intents.ignore = true;
  if (actions.mark_refund) intents.mark_refund = true;
  if (actions.mark_income) intents.mark_income = true;
  if (actions.add_tag && actions.add_tag.length > 0) {
    const seen = new Set(intents.add_tag ?? []);
    intents.add_tag = intents.add_tag ?? [];
    for (const id of actions.add_tag) if (!seen.has(id)) intents.add_tag.push(id);
  }
  if (actions.require_note) intents.require_note = true;
  if (actions.require_review) intents.require_review = true;
}

/** Evaluate a condition group with short-circuit AND/OR + recursive nested groups. */
export function evaluate_group(
  txn: RuleEvaluableTransaction,
  group: RuleConditionGroup
): boolean {
  const nested = group.nested ?? [];

  // Defensive: a truly empty group must NEVER match (empty AND would match everything).
  if (group.conditions.length === 0 && nested.length === 0) return false;

  if (group.op === "AND") {
    for (const c of group.conditions) if (!evaluate_condition(txn, c)) return false;
    for (const g of nested) if (!evaluate_group(txn, g)) return false;
    return true;
  }
  // OR
  for (const c of group.conditions) if (evaluate_condition(txn, c)) return true;
  for (const g of nested) if (evaluate_group(txn, g)) return true;
  return false;
}

/** Evaluate a single condition against the transaction. Unknown/ill-typed values → false. */
export function evaluate_condition(
  txn: RuleEvaluableTransaction,
  c: RuleCondition
): boolean {
  switch (c.variable) {
  case "merchant":
    // Match against BOTH the cleaned merchant name AND the raw description, case-insensitive.
    return (
      match_string(txn.merchant_name ?? "", c) || match_string(txn.name ?? "", c)
    );
  case "category":
    return match_string(effective_category(txn), c);
  case "account":
    return match_string(txn.account_id, c);
  case "amount":
    // Compare on the ABSOLUTE amount (users think in magnitudes, not Plaid's sign convention).
    return match_amount(Math.abs(txn.amount), c);
  case "date":
    return match_date(txn.transaction_date, c);
  case "tag":
    return match_tag(txn.tags ?? [], c);
  default:
    return assert_never_variable(c.variable);
  }
}

/** Tag variable: `has` — true when the running tag set contains the given tag id. */
function match_tag(tags: string[], c: RuleCondition): boolean {
  const target = String(c.value ?? "").trim();
  if (target.length === 0) return false;
  switch (c.operator) {
  case "has":
    return tags.includes(target);
  default:
    return false; // operator not valid for the tag variable
  }
}

/** The category rules test: the user-set category if present, else the Plaid-derived one. */
function effective_category(txn: RuleEvaluableTransaction): string {
  return txn.internal_primary_category ?? txn.plaid_primary_category ?? "";
}

/** String variables (merchant/category/account): `contains`/`equals`, case-insensitive. */
function match_string(field_value: string, c: RuleCondition): boolean {
  const target = String(c.value ?? "").trim().toLowerCase();
  if (target.length === 0) return false;
  const value = field_value.trim().toLowerCase();
  switch (c.operator) {
  case "contains":
    return value.includes(target);
  case "equals":
    return value === target;
  default:
    return false; // operator not valid for a string variable
  }
}

/** Amount variable: numeric comparisons against the absolute amount. */
function match_amount(abs_amount: number, c: RuleCondition): boolean {
  const v = as_number(c.value);
  if (v === null) return false;
  switch (c.operator) {
  case "lt":
    return abs_amount < v;
  case "lte":
    return abs_amount <= v;
  case "eq":
    return abs_amount === v;
  case "gte":
    return abs_amount >= v;
  case "gt":
    return abs_amount > v;
  case "between": {
    const v2 = as_number(c.value2);
    if (v2 === null) return false;
    const lo = Math.min(v, v2);
    const hi = Math.max(v, v2);
    return abs_amount >= lo && abs_amount <= hi;
  }
  default:
    return false; // operator not valid for the amount variable
  }
}

/** Date variable: calendar-day (UTC) comparisons — inclusive `between`/`up_to`/`on`. */
function match_date(txn_date: Date, c: RuleCondition): boolean {
  const day = utc_day(txn_date);
  if (day === null) return false;
  const v = to_utc_day(c.value);
  if (v === null) return false;
  switch (c.operator) {
  case "before":
    return day < v;
  case "after":
    return day > v;
  case "on":
    return day === v;
  case "up_to":
    return day <= v;
  case "between": {
    const v2 = to_utc_day(c.value2);
    if (v2 === null) return false;
    const lo = Math.min(v, v2);
    const hi = Math.max(v, v2);
    return day >= lo && day <= hi;
  }
  default:
    return false; // operator not valid for the date variable
  }
}

/** Coerce a rule value to a finite number, or null. */
function as_number(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** UTC-normalized day ordinal for a Date, or null if invalid. */
function utc_day(d: Date): number | null {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Parse a rule date value (ISO string or epoch ms) to a UTC day ordinal, or null. */
function to_utc_day(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  const d = typeof value === "number" ? new Date(value) : new Date(value);
  return utc_day(d);
}

/** Exhaustiveness guard for the variable switch. */
function assert_never_variable(_v: RuleVariable): false {
  return false;
}

/** Re-export for callers that construct groups programmatically in tests. */
export type { ConditionOperator };
