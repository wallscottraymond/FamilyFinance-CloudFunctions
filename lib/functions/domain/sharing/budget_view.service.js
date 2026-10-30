"use strict";
/**
 * Budgets belong to a view (D6, D9, D32, D13; PD6)
 *
 * A budget's owner key is its view: a uid for Me, "group:<groupId>" for a group.
 * Group budgets count only the group's money (derive, Phase 3). Moving keeps the
 * budget and its history; copying makes a new group budget with the same
 * settings. A budget moved in goes back to whoever brought it when they leave.
 *
 * PURE: no IO.
 *
 * @module domain/sharing/budget_view
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROUP_KEY_PREFIX = void 0;
exports.group_view_key = group_view_key;
exports.group_id_of_key = group_id_of_key;
exports.can_manage_budget = can_manage_budget;
exports.plan_move_budget = plan_move_budget;
exports.plan_copy_budgets = plan_copy_budgets;
exports.budgets_returned = budgets_returned;
const types_1 = require("../../types");
const group_service_1 = require("./group.service");
exports.GROUP_KEY_PREFIX = "group:";
/** The owner key of a group's budgets. */
function group_view_key(group_id) {
    return `${exports.GROUP_KEY_PREFIX}${group_id}`;
}
/** The group id inside an owner key, or null for a person's key. */
function group_id_of_key(owner_key) {
    return owner_key.startsWith(exports.GROUP_KEY_PREFIX)
        ? owner_key.slice(exports.GROUP_KEY_PREFIX.length)
        : null;
}
/**
 * Can `actor` edit / delete this budget? Me budgets: only their owner. Group
 * budgets: any member of that group (PD4: owner + full).
 */
function can_manage_budget(owner_key, actor_id, group) {
    const gid = group_id_of_key(owner_key);
    if (gid === null)
        return owner_key === actor_id;
    return !!group && group.id === gid && (0, group_service_1.is_member)(group, actor_id);
}
function normalize_name(name) {
    return name.trim().replace(/\s+/g, " ").toLowerCase();
}
const identity = (c) => c;
/** The first budget in `others` that clashes (same name or a shared FIRST category — a legacy
 *  code and its slug are the same category, canon A3). */
function find_clash(b, others, first_of) {
    var _a;
    const cats = new Set(b.category_ids.map(first_of));
    return ((_a = others.find((o) => o.id !== b.id &&
        !o.is_everything_else &&
        (normalize_name(o.name) === normalize_name(b.name) ||
            o.category_ids.some((c) => cats.has(first_of(c)))))) !== null && _a !== void 0 ? _a : null);
}
/**
 * Move a budget between Me and a group (D9). Me → group: the budget's owner,
 * who must be a member. Group → Me: any member; it lands in the mover's Me.
 * Refused when the destination already has a budget with that name or one of
 * its categories (counting would be ambiguous). Everything Else never moves.
 */
function plan_move_budget(budget, actor_id, source_group, target, target_view_budgets, first_of = identity) {
    if (!budget)
        return (0, types_1.validation_failed)(["This budget isn't available"]);
    if (budget.is_everything_else)
        return (0, types_1.validation_failed)(["Everything Else can't be moved"]);
    if (!can_manage_budget(budget.owner_key, actor_id, source_group)) {
        return (0, types_1.validation_failed)(["This budget isn't available"]);
    }
    const from_group = group_id_of_key(budget.owner_key);
    let new_owner_key;
    let brought_by;
    if (target.type === "me") {
        if (from_group === null)
            return (0, types_1.validation_failed)(["This budget is already yours"]);
        new_owner_key = actor_id;
        brought_by = null;
    }
    else {
        if (from_group !== null) {
            return (0, types_1.validation_failed)(["Move it to Me first, then to the other group"]);
        }
        if (!target.group || !(0, group_service_1.is_member)(target.group, actor_id)) {
            return (0, types_1.validation_failed)(["You're not in this group"]);
        }
        new_owner_key = group_view_key(target.group.id);
        brought_by = actor_id;
    }
    const clash = find_clash(budget, target_view_budgets, first_of);
    if (clash) {
        return (0, types_1.validation_failed)([
            `There's already a budget there for this (${clash.name}). Edit that one instead.`,
        ]);
    }
    return (0, types_1.success)({ new_owner_key, brought_by });
}
/**
 * Copy the caller's Me budgets into a group (D32). Each copy is a new group
 * budget (same name, categories, cadence; amount as chosen); the originals stay.
 * A budget the group already has (same name or a shared category) is reported
 * as a conflict instead of creating a duplicate. Everything Else is never copied.
 */
function plan_copy_budgets(group, actor_id, items, group_budgets, first_of = identity, allow_partial = true) {
    if (!(0, group_service_1.is_member)(group, actor_id))
        return (0, types_1.validation_failed)(["You're not in this group"]);
    const errors = [];
    const creates = [];
    const conflicts = [];
    const planned = [...group_budgets];
    for (const item of items) {
        const b = item.budget;
        if (!b || b.owner_key !== actor_id) {
            errors.push("You can only copy your own budgets");
            continue;
        }
        if (b.is_everything_else) {
            errors.push("Everything Else can't be copied");
            continue;
        }
        if (!(item.amount > 0)) {
            errors.push(`Set an amount for ${b.name}`);
            continue;
        }
        const clash = find_clash(b, planned, first_of);
        if (clash) {
            // Only SOME categories overlap (and no name clash): copy the rest — each category still
            // has one budget in the group (X16). A same-name clash, or nothing left, copies nothing.
            const owned = new Set(planned
                .filter((o) => o.id !== b.id && !o.is_everything_else)
                .flatMap((o) => o.category_ids.map(first_of)));
            const name_clash = planned.some((o) => o.id !== b.id &&
                !o.is_everything_else &&
                normalize_name(o.name) === normalize_name(b.name));
            const free = b.category_ids.filter((c) => !owned.has(first_of(c)));
            const partial = allow_partial && !name_clash && free.length > 0;
            conflicts.push(Object.assign({ source_budget_id: b.id, existing_budget_id: clash.id, existing_name: clash.name, existing_amount: clash.amount }, (partial ? { copied_category_ids: free } : {})));
            if (partial) {
                creates.push({ source: b, amount: item.amount, category_ids: free });
                planned.push(Object.assign(Object.assign({}, b), { id: `planned:${b.id}`, category_ids: free }));
            }
            continue;
        }
        creates.push({ source: b, amount: item.amount });
        planned.push(Object.assign(Object.assign({}, b), { id: `planned:${b.id}` }));
    }
    if (errors.length)
        return (0, types_1.validation_failed)([...new Set(errors)]);
    return (0, types_1.success)({ creates, conflicts });
}
/**
 * Budgets that leave a group with the people leaving (D13): the ones they moved
 * in go back to them. "all" (group deleted) returns every moved-in budget.
 * Budgets made or copied in the group stay.
 */
function budgets_returned(group_budgets, leaving) {
    return group_budgets
        .filter((b) => b.brought_by && (leaving === "all" || leaving.includes(b.brought_by)))
        .map((b) => ({ budget_id: b.id, to_owner_key: b.brought_by }));
}
//# sourceMappingURL=budget_view.service.js.map