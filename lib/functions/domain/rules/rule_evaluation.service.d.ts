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
import { ConditionOperator, Rule, RuleActionIntents, RuleCondition, RuleConditionGroup, RuleEvaluableTransaction } from "../../types/rules.types";
/**
 * Evaluate all rules against one transaction; return the merged action intents.
 * `rules` need not be pre-sorted — they are sorted by `priority` here for determinism.
 */
export declare function evaluate_rules(txn: RuleEvaluableTransaction, rules: Rule[]): RuleActionIntents;
/** Evaluate a condition group with short-circuit AND/OR + recursive nested groups. */
export declare function evaluate_group(txn: RuleEvaluableTransaction, group: RuleConditionGroup): boolean;
/** Evaluate a single condition against the transaction. Unknown/ill-typed values → false. */
export declare function evaluate_condition(txn: RuleEvaluableTransaction, c: RuleCondition): boolean;
/** Re-export for callers that construct groups programmatically in tests. */
export type { ConditionOperator };
//# sourceMappingURL=rule_evaluation.service.d.ts.map