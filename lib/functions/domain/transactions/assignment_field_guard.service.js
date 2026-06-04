"use strict";
/**
 * Assignment Field Guard Domain Service
 *
 * Pure decision: did a transaction write change anything the assignment engine
 * cares about? The thin trigger uses this to enqueue an `assign_transaction` job
 * ONLY on assignment- or spend-relevant changes — cosmetic edits (notes, tags,
 * description) run nothing at all.
 *
 * Relevant fields: the transaction date, amount, active flag, the
 * category-feeding fields (merchant/name), and — per split — amount, budget id,
 * category, manual-pin source, ignored flag, and the recurring links; plus any
 * split add/remove. Creates and deletes are always relevant.
 *
 * NO async, NO IO, NO side effects.
 *
 * @module domain/transactions/assignment_field_guard
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.is_assignment_relevant_change = is_assignment_relevant_change;
exports.is_spend_relevant_change = is_spend_relevant_change;
/** Fields on the transaction doc that affect assignment/spend (besides splits). */
const TXN_RELEVANT_FIELDS = [
    "transactionDate",
    "amount",
    "isActive",
    "merchantName", // feeds category matching
    "name", // feeds category matching
];
/** Per-split fields that affect assignment/spend. */
const SPLIT_RELEVANT_FIELDS = [
    "amount",
    "budgetId",
    "budgetAssignmentSource",
    "internalPrimaryCategory",
    "plaidPrimaryCategory",
    // The engine matches budgets on the DETAILED category, so a change to these
    // (e.g. a user re-categorization) must re-trigger assignment.
    "internalDetailedCategory",
    "plaidDetailedCategory",
    "outflowId",
    "inflowId",
    "isIgnored",
];
/** Stable, comparable projection of the relevant split fields, keyed by splitId. */
function project_splits(doc) {
    var _a;
    const splits = (_a = doc.splits) !== null && _a !== void 0 ? _a : [];
    const projected = splits
        .map((s) => {
        var _a;
        const row = { split_id: s.splitId };
        for (const f of SPLIT_RELEVANT_FIELDS) {
            row[f] = (_a = s[f]) !== null && _a !== void 0 ? _a : null;
        }
        return row;
    })
        .sort((a, b) => String(a.split_id).localeCompare(String(b.split_id)));
    return JSON.stringify(projected);
}
/** Normalize a Firestore Timestamp-ish / primitive value for comparison. */
function normalize(value) {
    if (value && typeof value === "object" && "toMillis" in value) {
        return value.toMillis();
    }
    return value !== null && value !== void 0 ? value : null;
}
/**
 * Whether an assignment-relevant field changed between two transaction states.
 * `before == null` → create; `after == null` → hard delete. Both are relevant.
 *
 * PURE FUNCTION.
 */
function is_assignment_relevant_change(before, after) {
    if (!before || !after) {
        return true; // create or hard delete
    }
    for (const field of TXN_RELEVANT_FIELDS) {
        if (normalize(before[field]) !== normalize(after[field])) {
            return true;
        }
    }
    return project_splits(before) !== project_splits(after);
}
/** Transaction-level fields that affect computed SPEND (not assignment). */
const SPEND_TXN_FIELDS = [
    "isPending",
    "type", // transfer is excluded from spend
    "transactionDate", // which period the spend lands in
    "isActive",
];
/** Per-split fields that affect computed SPEND (not assignment). */
const SPEND_SPLIT_FIELDS = ["amount", "isIgnored", "budgetId"];
/** Projection of the spend-affecting split fields, keyed + sorted by splitId. */
function project_spend_splits(doc) {
    var _a;
    const splits = (_a = doc.splits) !== null && _a !== void 0 ? _a : [];
    const projected = splits
        .map((s) => {
        var _a;
        const row = { split_id: s.splitId };
        for (const f of SPEND_SPLIT_FIELDS) {
            row[f] = (_a = s[f]) !== null && _a !== void 0 ? _a : null;
        }
        return row;
    })
        .sort((a, b) => String(a.split_id).localeCompare(String(b.split_id)));
    return JSON.stringify(projected);
}
/**
 * Whether a SPEND-affecting field changed on an UPDATE (e.g. a split amount or
 * `isIgnored` toggle) — these don't change the budget assignment, so the assign
 * orchestrator skips its recompute fan-out, but the budget's spend MUST be
 * recomputed. Create/delete return false (handled elsewhere).
 *
 * PURE FUNCTION.
 */
function is_spend_relevant_change(before, after) {
    if (!before || !after) {
        return false; // create → assign fan-out; delete → handled by the trigger
    }
    for (const field of SPEND_TXN_FIELDS) {
        if (normalize(before[field]) !== normalize(after[field])) {
            return true;
        }
    }
    return project_spend_splits(before) !== project_spend_splits(after);
}
//# sourceMappingURL=assignment_field_guard.service.js.map