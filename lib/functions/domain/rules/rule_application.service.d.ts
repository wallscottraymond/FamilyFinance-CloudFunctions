/**
 * Rule application — PURE domain service (no IO, deterministic).
 *
 * `apply_rule_intents(txn, intents)` folds the resolved `RuleActionIntents` (from `evaluate_rules`)
 * onto a `TransactionForPersistence` IN MEMORY, before it is written. Returns a NEW object (never
 * mutates the input).
 *
 * SCOPE: field-set actions applied in memory before the write —
 *   - `assign_budget_id` → pins `budget_id` + `budget_assignment_source = "manual"` on every split
 *     (the durable pin the engine preserves; rule provenance stays in `rules[]`).
 *   - `assign_category`  → the user's own pick on every split (canon M5): `first_category_id` =
 *                          the rule's first slug, `category_source = "user"` (Plaid never
 *                          overrides it; the engine fills the overall slug from the collection).
 *   - `ignore`           → `is_ignored = true` on every split.
 *   - `mark_refund`      → `is_refund = true` on every split.
 *   - `mark_income`      → txn `type = "income"`.
 *   - `add_tag`          → unions tag ids into every split's `.tags` (the doc's `tagIds` follows).
 *   - `require_review`   → txn `needs_review = true` (non-blocking; drives the review queue).
 *   - `require_note`     → txn `needs_note = true`.
 *   - `split`            → REPLACES splits: divide by percent/amount + an unassigned remainder.
 *   - `applied_rule_ids` → unioned into each split's `split.rules[]`.
 *
 * DEFERRED (documented in Transaction-Rules-Engine.md):
 *   - `make_recurring`   — orchestrator side effect (blocked on Convert-To-Recurring).
 * These intents are intentionally read-but-not-applied here; the caller handles `make_recurring`.
 */
import { RuleActionIntents } from "../../types/rules.types";
import { TransactionForPersistence } from "../../types/plaid/transaction_sync.types";
/**
 * Drop category intents that aren't a first category the collection knows (canon C1): a legacy /
 * display-name value ("Coffee") would become a permanent user pick that matches no budget and
 * that Plaid could never correct. PURE.
 */
export declare function only_known_categories(intents: RuleActionIntents, is_known_first: (slug: string) => boolean): RuleActionIntents;
/**
 * "Mark as income" makes the money INCOME, not just a credit: with no category of its own from the
 * rule, it takes the income category (`income_slug` — the first category Plaid's "other income"
 * maps to), so every reader counts it as money in (a credit-typed spending category would read as
 * a refund). PURE.
 */
export declare function with_income_category(intents: RuleActionIntents, income_slug: string | null): RuleActionIntents;
/** Apply the supported field-set intents to a transaction (pure; returns a new object). */
export declare function apply_rule_intents(txn: TransactionForPersistence, intents: RuleActionIntents): TransactionForPersistence;
//# sourceMappingURL=rule_application.service.d.ts.map