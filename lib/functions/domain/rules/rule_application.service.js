"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.apply_rule_intents = apply_rule_intents;
/** Apply the supported field-set intents to a transaction (pure; returns a new object). */
function apply_rule_intents(txn, intents) {
    var _a;
    const has_split = intents.split !== undefined && intents.split.length > 0;
    // Nothing this service can apply → return the input unchanged (referential no-op).
    const has_add_tag = intents.add_tag !== undefined && intents.add_tag.length > 0;
    const applies = has_split ||
        has_add_tag ||
        intents.assign_budget_id !== undefined ||
        intents.assign_category !== undefined ||
        intents.ignore === true ||
        intents.mark_refund === true ||
        intents.mark_income === true ||
        intents.require_review === true ||
        intents.require_note === true ||
        intents.applied_rule_ids.length > 0;
    if (!applies)
        return txn;
    const type = intents.mark_income ? "income" : txn.type;
    const internal_primary_category = (_a = intents.assign_category) !== null && _a !== void 0 ? _a : txn.internal_primary_category;
    // `split` REPLACES the splits array; otherwise the field-set effects map onto existing splits.
    const splits = has_split
        ? materialize_splits(txn, intents, internal_primary_category)
        : txn.splits.map((s) => apply_to_split(s, intents, internal_primary_category));
    return Object.assign(Object.assign(Object.assign(Object.assign({}, txn), { type,
        internal_primary_category,
        splits }), (intents.require_review ? { needs_review: true } : {})), (intents.require_note ? { needs_note: true } : {}));
}
/** Apply the split-level effects (category / ignore / refund / rule-id tracking). */
function apply_to_split(split, intents, internal_primary_category) {
    var _a;
    return Object.assign(Object.assign(Object.assign({}, split), (intents.assign_budget_id !== undefined
        ? {
            budget_id: intents.assign_budget_id,
            budget_assignment_source: "manual",
        }
        : {})), { internal_primary_category: intents.assign_category !== undefined
            ? internal_primary_category
            : split.internal_primary_category, is_ignored: intents.ignore ? true : split.is_ignored, is_refund: intents.mark_refund ? true : split.is_refund, tags: union(split.tags, (_a = intents.add_tag) !== null && _a !== void 0 ? _a : []), rules: union(split.rules, intents.applied_rule_ids) });
}
/** Round to cents. */
function round2(n) {
    return Math.round(n * 100) / 100;
}
/**
 * Materialize the `split` action: divide the transaction (by percent or fixed amount) into new
 * splits derived from the base split. Any leftover becomes ONE unassigned remainder split so the
 * splits still sum to the total (the engine then assigns the remainder). Per-spec `budget_id`
 * becomes a durable "manual" pin; `category` sets the split's category.
 */
function materialize_splits(txn, intents, internal_primary_category) {
    var _a;
    const base = txn.splits[0];
    const total = round2(txn.splits.reduce((sum, s) => sum + s.amount, 0));
    const specs = (_a = intents.split) !== null && _a !== void 0 ? _a : [];
    const out = [];
    let allocated = 0;
    specs.forEach((spec, i) => {
        var _a;
        const portion = spec.percent !== undefined ? round2((total * spec.percent) / 100) : (_a = spec.amount) !== null && _a !== void 0 ? _a : 0;
        allocated = round2(allocated + portion);
        out.push(make_split(base, `${base.split_id}_r${i}`, portion, spec, intents, internal_primary_category, false));
    });
    const remainder = round2(total - allocated);
    if (Math.abs(remainder) >= 0.01) {
        out.push(make_split(base, `${base.split_id}_rem`, remainder, {}, intents, internal_primary_category, true));
    }
    return out;
}
/** Build one materialized split from the base split + a spec. */
function make_split(base, split_id, amount, spec, intents, internal_primary_category, is_remainder) {
    var _a, _b, _c;
    return Object.assign(Object.assign(Object.assign(Object.assign({}, base), { split_id,
        amount, is_default: is_remainder }), (spec.budget_id !== undefined
        ? { budget_id: spec.budget_id, budget_assignment_source: "manual" }
        : { budget_id: "unassigned", budget_assignment_source: undefined })), { internal_primary_category: (_b = (_a = spec.category) !== null && _a !== void 0 ? _a : internal_primary_category) !== null && _b !== void 0 ? _b : base.internal_primary_category, is_ignored: intents.ignore ? true : base.is_ignored, is_refund: intents.mark_refund ? true : base.is_refund, tags: union(base.tags, (_c = intents.add_tag) !== null && _c !== void 0 ? _c : []), rules: union(base.rules, intents.applied_rule_ids) });
}
/** Order-preserving de-duplicated union of two id lists. */
function union(existing, added) {
    if (added.length === 0)
        return existing;
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
//# sourceMappingURL=rule_application.service.js.map