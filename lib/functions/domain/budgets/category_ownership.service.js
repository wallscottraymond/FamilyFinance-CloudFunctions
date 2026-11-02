"use strict";
/**
 * Category Ownership Domain Service
 *
 * Pure claim planning: one budget per category PER VIEW (canon A3 / A3b). The resolver
 * supplies the view's budgets (IO); this service decides who a take comes from and refuses one
 * that would leave a budget empty. NO async, NO IO, NO side effects.
 *
 * @module domain/budgets/category_ownership
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plan_view_claims = plan_view_claims;
exports.plan_view_arrival = plan_view_arrival;
/**
 * Deduplicate a string array preserving first-seen order.
 *
 * PURE helper.
 */
function unique(values) {
    return [...new Set(values)];
}
/**
 * Plan the claims when a budget takes categories (create or edit) — canon A3 / A3b:
 *   - ownership is PER VIEW (only `view_budgets`, i.e. the same Me / group owner key);
 *   - compared by FIRST category (`first_of`), so taking "groceries" also takes a legacy
 *     `FOOD_AND_DRINK_GROCERIES` another budget still stores (it's removed there);
 *   - a take can't leave another real budget with NO categories (A3b: ≥ 1 always) — the user
 *     must give that budget another category first;
 *   - Everything Else is never a real owner (it's the fallback).
 * Returns one claim per id removed from a source, plus `from_budget_id: null` for added
 * categories nobody owned.
 *
 * PURE FUNCTION.
 */
function plan_view_claims(input) {
    const key = (id) => { var _a; return (_a = input.first_of(id)) !== null && _a !== void 0 ? _a : id; };
    const wanted = new Set(unique(input.added_category_ids).map(key));
    const claims = [];
    const errors = [];
    const owned = new Set();
    for (const b of input.view_budgets) {
        if (b.id === input.budget_id || b.is_everything_else)
            continue;
        const taken = b.category_ids.filter((id) => wanted.has(key(id)));
        if (taken.length === 0)
            continue;
        if (taken.length === b.category_ids.length) {
            errors.push(`"${b.name}" would have no categories left. Give it another category first, ` +
                "or delete it.");
            continue;
        }
        for (const id of taken) {
            claims.push({ category_id: id, from_budget_id: b.id });
            owned.add(key(id));
        }
    }
    if (errors.length)
        return { validation_errors: errors };
    for (const id of unique(input.added_category_ids)) {
        if (!owned.has(key(id)))
            claims.push({ category_id: id, from_budget_id: null });
    }
    return { entity: { claims } };
}
/**
 * A budget ARRIVES in a view it didn't choose (it comes back to its owner's Me view when they
 * leave a group — Code-Health-Review S1-M4): the budget ALREADY in the view keeps any category
 * both budget (canon A3 / A3b: one owner per category per view, compared by FIRST category,
 * Everything Else is never an owner). Returns the arriving budget's categories split into the
 * ones it keeps and the ones it gives up (the ids it actually stores). It may keep none — the
 * caller decides what an empty budget becomes (paused).
 *
 * PURE FUNCTION.
 */
function plan_view_arrival(input) {
    const key = (id) => { var _a; return (_a = input.first_of(id)) !== null && _a !== void 0 ? _a : id; };
    const owned = new Set(input.view_budgets
        .filter((b) => b.id !== input.budget_id && !b.is_everything_else)
        .flatMap((b) => b.category_ids.map(key)));
    const kept = [];
    const removed = [];
    for (const id of unique(input.category_ids))
        (owned.has(key(id)) ? removed : kept).push(id);
    return { kept_category_ids: kept, removed_category_ids: removed };
}
//# sourceMappingURL=category_ownership.service.js.map