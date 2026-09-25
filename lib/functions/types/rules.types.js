"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=rules.types.js.map