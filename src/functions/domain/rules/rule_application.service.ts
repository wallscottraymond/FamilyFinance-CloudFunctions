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
import {
  TransactionForPersistence,
  TransactionSplitForPersistence,
} from "../../types/plaid/transaction_sync.types";

/**
 * Drop category intents that aren't a first category the collection knows (canon C1): a legacy /
 * display-name value ("Coffee") would become a permanent user pick that matches no budget and
 * that Plaid could never correct. PURE.
 */
export function only_known_categories(
  intents: RuleActionIntents,
  is_known_first: (slug: string) => boolean
): RuleActionIntents {
  const ok = (c: string | undefined) => c === undefined || is_known_first(c);
  return {
    ...intents,
    assign_category: ok(intents.assign_category) ? intents.assign_category : undefined,
    ...(intents.split
      ? {
        split: intents.split.map((spec) =>
          ok(spec.category) ? spec : { ...spec, category: undefined }
        ),
      }
      : {}),
  };
}

/**
 * "Mark as income" makes the money INCOME, not just a credit: with no category of its own from the
 * rule, it takes the income category (`income_slug` — the first category Plaid's "other income"
 * maps to), so every reader counts it as money in (a credit-typed spending category would read as
 * a refund). PURE.
 */
export function with_income_category(
  intents: RuleActionIntents,
  income_slug: string | null
): RuleActionIntents {
  if (!intents.mark_income || intents.assign_category !== undefined || !income_slug) return intents;
  return { ...intents, assign_category: income_slug };
}

/** Apply the supported field-set intents to a transaction (pure; returns a new object). */
export function apply_rule_intents(
  txn: TransactionForPersistence,
  intents: RuleActionIntents
): TransactionForPersistence {
  const has_split = intents.split !== undefined && intents.split.length > 0;
  // Nothing this service can apply → return the input unchanged (referential no-op).
  const has_add_tag = intents.add_tag !== undefined && intents.add_tag.length > 0;
  const applies =
    has_split ||
    has_add_tag ||
    intents.assign_budget_id !== undefined ||
    intents.assign_category !== undefined ||
    intents.ignore === true ||
    intents.mark_refund === true ||
    intents.mark_income === true ||
    intents.require_review === true ||
    intents.require_note === true ||
    intents.applied_rule_ids.length > 0;
  if (!applies) return txn;

  const type = intents.mark_income ? "income" : txn.type;

  // `split` REPLACES the splits array; otherwise the field-set effects map onto existing splits.
  const splits = has_split
    ? materialize_splits(txn, intents)
    : txn.splits.map((s) => apply_to_split(s, intents));

  return {
    ...txn,
    type,
    splits,
    ...(intents.require_review ? { needs_review: true } : {}),
    ...(intents.require_note ? { needs_note: true } : {}),
  };
}

/** A rule's category as the user's own pick (canon M5) — empty when the rule sets none. */
function category_pick(
  first_slug: string | undefined
): Partial<TransactionSplitForPersistence> {
  if (first_slug === undefined || first_slug.trim() === "") return {};
  return {
    category_source: "user",
    first_category_id: first_slug.trim(),
    overall_category_id: null,
    second_category_id: null,
  };
}

/** Apply the split-level effects (category / ignore / refund / rule-id tracking). */
function apply_to_split(
  split: TransactionSplitForPersistence,
  intents: RuleActionIntents
): TransactionSplitForPersistence {
  return {
    ...split,
    // Pin the budget as a durable "manual" assignment the engine won't override.
    ...(intents.assign_budget_id !== undefined
      ? {
        budget_id: intents.assign_budget_id,
        budget_assignment_source: "manual" as const,
      }
      : {}),
    ...category_pick(intents.assign_category),
    is_ignored: intents.ignore ? true : split.is_ignored,
    is_refund: intents.mark_refund ? true : split.is_refund,
    tags: union(split.tags, intents.add_tag ?? []),
    rules: union(split.rules, intents.applied_rule_ids),
  };
}

/** Round to cents. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Materialize the `split` action: divide the transaction (by percent or fixed amount) into new
 * splits derived from the base split. Any leftover becomes ONE unassigned remainder split so the
 * splits still sum to the total (the engine then assigns the remainder). Per-spec `budget_id`
 * becomes a durable "manual" pin; `category` sets the split's category.
 */
function materialize_splits(
  txn: TransactionForPersistence,
  intents: RuleActionIntents
): TransactionSplitForPersistence[] {
  const base = txn.splits[0];
  const total = round2(txn.splits.reduce((sum, s) => sum + s.amount, 0));
  const specs = intents.split ?? [];

  // Specs are user input (A1-H1): each portion is capped at what's left of the transaction,
  // takes the transaction's sign (a refund splits into negative parts), and a spec that is
  // non-positive or finds nothing left makes no split. So the parts always add up to the total
  // and the remainder can't go negative.
  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);
  // Nothing to divide: keep the existing splits (ids + amounts) rather than materializing none,
  // but still apply the rule's other per-split actions to them.
  if (magnitude < 0.01) {
    return txn.splits.map((s) => make_split(s, s.split_id, s.amount, {}, intents, true));
  }
  const out: TransactionSplitForPersistence[] = [];
  let allocated = 0;
  specs.forEach((spec, i) => {
    const asked =
      spec.percent !== undefined ? round2((magnitude * spec.percent) / 100) : spec.amount ?? 0;
    const portion = round2(Math.min(Math.max(asked, 0), round2(magnitude - allocated)));
    if (!(portion >= 0.01)) return;
    allocated = round2(allocated + portion);
    out.push(
      make_split(
        base, `${base.split_id}_r${i}`, round2(sign * portion), spec, intents, false
      )
    );
  });

  const remainder = round2(sign * (magnitude - allocated));
  if (Math.abs(remainder) >= 0.01) {
    out.push(
      make_split(
        base, `${base.split_id}_rem`, remainder, {}, intents, true
      )
    );
  }
  return out;
}

/** Build one materialized split from the base split + a spec. */
function make_split(
  base: TransactionSplitForPersistence,
  split_id: string,
  amount: number,
  spec: { budget_id?: string; category?: string },
  intents: RuleActionIntents,
  is_remainder: boolean
): TransactionSplitForPersistence {
  return {
    ...base,
    split_id,
    amount,
    is_default: is_remainder,
    ...(spec.budget_id !== undefined
      ? { budget_id: spec.budget_id, budget_assignment_source: "manual" as const }
      : { budget_id: "unassigned", budget_assignment_source: undefined }),
    ...category_pick(spec.category ?? intents.assign_category),
    is_ignored: intents.ignore ? true : base.is_ignored,
    is_refund: intents.mark_refund ? true : base.is_refund,
    tags: union(base.tags, intents.add_tag ?? []),
    rules: union(base.rules, intents.applied_rule_ids),
  };
}

/** Order-preserving de-duplicated union of two id lists. */
function union(existing: string[], added: string[]): string[] {
  if (added.length === 0) return existing;
  const seen = new Set(existing);
  const out = [...existing];
  for (const id of added) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
