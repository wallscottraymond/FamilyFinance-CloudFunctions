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
 *   - `assign_category`  → sets `internal_primary_category` on the txn + every split.
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
/** Apply the supported field-set intents to a transaction (pure; returns a new object). */
export declare function apply_rule_intents(txn: TransactionForPersistence, intents: RuleActionIntents): TransactionForPersistence;
//# sourceMappingURL=rule_application.service.d.ts.map