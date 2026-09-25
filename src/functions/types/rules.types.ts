/**
 * Transaction Rules Engine — type definitions.
 *
 * A user-defined "Rule Book": each rule is `[conditions] (AND/OR) → action(s)` applied to
 * transactions IN MEMORY during ingestion, before the Firestore write (see
 * `1 Projects/Transaction-Rules-Engine.md`). This file defines the rule schema + the evaluation
 * result ("action intents"). Evaluation itself is a PURE domain service
 * (`domain/rules/rule_evaluation.service.ts`) — no IO.
 *
 * Design notes:
 * - Stored one-doc-per-rule in `rules` (loaded once per sync batch, not per txn).
 * - Conditions are stored as a GROUP TREE (`RuleConditionGroup`); v1 exposes a single flat
 *   AND/OR group — so nested groups can be added later with no migration.
 * - Actions store RESOLVED target ids (`budget_id`, canonical `first_category`) captured at rule
 *   creation, so evaluation needs zero lookups.
 * - The `tag` variable is omitted from v1 (the `split.tags[]` field exists but nothing
 *   populates it yet).
 */

/** Transaction fields a rule can test. (`tag` deferred until tags are user-settable.) */
export type RuleVariable = "merchant" | "date" | "amount" | "category" | "account";

/** Operators for string variables (merchant, category, account). */
export type StringOperator = "contains" | "equals";

/** Operators for the amount variable. Compared against the transaction's ABSOLUTE amount. */
export type NumberOperator = "lt" | "lte" | "eq" | "gte" | "gt" | "between";

/** Operators for the date variable (absolute — no relative/now, so evaluation stays pure). */
export type DateOperator = "before" | "after" | "on" | "up_to" | "between";

export type RuleOperator = StringOperator | NumberOperator | DateOperator;

/**
 * A single condition: `<variable> <operator> <value>[ .. <value2>]`.
 * `value2` is only used by the `between` operators (amount/date).
 * Date values are ISO date strings ("2026-09-01") or epoch ms.
 */
export interface RuleCondition {
  variable: RuleVariable;
  operator: RuleOperator;
  value: string | number;
  value2?: string | number;
}

/** How the conditions in a group combine. */
export type ConditionOperator = "AND" | "OR";

/**
 * A group of conditions joined by one operator. v1 uses a single top-level group (flat AND/OR);
 * `nested` is reserved so `(A AND B) OR C` logic can be added later without a schema change.
 */
export interface RuleConditionGroup {
  op: ConditionOperator;
  conditions: RuleCondition[];
  nested?: RuleConditionGroup[];
}

/** A split directive for the `split` action (by percent OR fixed amount). */
export interface RuleSplitSpec {
  /** Portion as a percentage (0–100). Mutually exclusive with `amount`. */
  percent?: number;
  /** Portion as a fixed amount. Mutually exclusive with `percent`. */
  amount?: number;
  /** Optional per-split resolved budget id. */
  budget_id?: string;
  /** Optional per-split canonical first_category. */
  category?: string;
}

/**
 * Actions a rule applies when its conditions match. A rule may carry several.
 * All target ids are RESOLVED at rule-creation time (no lookups at eval).
 */
export interface RuleActions {
  /** Pin the split(s) to this budget (durable — the assignment engine must preserve it). */
  assign_budget_id?: string;
  /** Set the canonical first_category. */
  assign_category?: string;
  /** Split the transaction by percent or amount. */
  split?: RuleSplitSpec[];
  /** Exclude the split(s) from spend. */
  ignore?: boolean;
  /** Mark as a refund. */
  mark_refund?: boolean;
  /** Promote to a recurring definition (SIDE-EFFECTING — handled by the orchestrator). */
  make_recurring?: "outflow" | "inflow";
  /** Mark the transaction as income. */
  mark_income?: boolean;
  /** Flag that a note is expected (non-blocking). */
  require_note?: boolean;
  /** Flag for review (non-blocking). */
  require_review?: boolean;
}

/**
 * A stored rule (one Firestore doc in the `rules` collection).
 * `priority` = list order in the Rule Book (lower number = higher in the list = evaluated earlier;
 * later-evaluated rules override earlier ones on the same scalar field).
 */
export interface Rule {
  id: string;
  user_id: string;
  name: string;
  conditions: RuleConditionGroup;
  actions: RuleActions;
  priority: number;
  is_active: boolean;
}

/** Minimal transaction shape the evaluator reads (satisfied by TransactionForPersistence). */
export interface RuleEvaluableTransaction {
  merchant_name: string | null;
  name: string;
  amount: number;
  transaction_date: Date;
  account_id: string;
  plaid_primary_category: string;
  internal_primary_category: string | null;
}

/**
 * The resolved outcome of evaluating ALL matching rules against one transaction, in priority order.
 * Field-set intents apply to the persistence doc; `make_recurring` is a side effect the
 * orchestrator performs around the write.
 */
export interface RuleActionIntents {
  /** Ids of every rule that matched (tracked into `split.rules[]`). */
  applied_rule_ids: string[];

  // ---- field-set intents (last matching rule wins for scalars; booleans are OR-of-all) ----
  assign_budget_id?: string;
  assign_category?: string;
  split?: RuleSplitSpec[];
  ignore?: boolean;
  mark_refund?: boolean;
  mark_income?: boolean;
  require_note?: boolean;
  require_review?: boolean;

  // ---- side-effecting intent (orchestrator handles, not applied to the doc inline) ----
  make_recurring?: "outflow" | "inflow";
}
