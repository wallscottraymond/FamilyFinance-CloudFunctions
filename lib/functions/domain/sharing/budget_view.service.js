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
exports.RETURN_PAUSE_END_ISO = exports.GROUP_KEY_PREFIX = void 0;
exports.group_view_key = group_view_key;
exports.group_id_of_key = group_id_of_key;
exports.can_manage_budget = can_manage_budget;
exports.plan_move_budget = plan_move_budget;
exports.plan_copy_budgets = plan_copy_budgets;
exports.budgets_returned = budgets_returned;
exports.return_pause_range = return_pause_range;
exports.plan_budget_returns = plan_budget_returns;
exports.returned_budget_notes = returned_budget_notes;
const types_1 = require("../../types");
const group_service_1 = require("./group.service");
const category_ownership_service_1 = require("../budgets/category_ownership.service");
const budget_pause_service_1 = require("../budgets/budget_pause.service");
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
const NO_CATEGORIES_MOVE = "This budget has no categories yet. Give it one first, then move it.";
const NO_CATEGORIES_COPY = "It has no categories yet. Give it one first.";
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
    // A budget that came back empty (S1-M4) has nothing to count in a group; it can still LEAVE a
    // group, so one stranded there can be rescued.
    if (target.type === "group" && budget.category_ids.length === 0 && !budget.is_manual) {
        return (0, types_1.validation_failed)([NO_CATEGORIES_MOVE]);
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
    const skipped = [];
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
        // Decided here, before anything is created: create_budget would refuse it mid-batch.
        if (b.category_ids.length === 0 && !b.is_manual) {
            skipped.push({ source_budget_id: b.id, name: b.name, reason: NO_CATEGORIES_COPY });
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
    return (0, types_1.success)({ creates, conflicts, skipped });
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
/** The last day a returned, emptied budget stays paused ("until the user changes it"). */
exports.RETURN_PAUSE_END_ISO = "2099-12-31";
/** The pause an emptied returned budget gets: from today's UTC day on. PURE. */
function return_pause_range(now_ms) {
    return { start_day: (0, budget_pause_service_1.utc_day)(now_ms), end_day: (0, budget_pause_service_1.day_from_iso)(exports.RETURN_PAUSE_END_ISO) };
}
/**
 * Budgets going back to the people leaving (D13), checked against the Me view each lands in
 * (Code-Health-Review S1-M4; user decision 2026-11-02): the budget ALREADY in Me keeps any
 * clashing category (canon A3, compared by first category); the returning budget comes back
 * WITHOUT those categories, and PAUSED if none are left. Nothing is deleted. A budget that
 * already returned counts for the next one going to the same person.
 *
 * `me_budgets`: owner key → the budgets currently in that person's Me view.
 * PURE.
 */
function plan_budget_returns(group_budgets, leaving, me_budgets, first_of = identity) {
    var _a, _b;
    var _c;
    const planned = {};
    const out = [];
    for (const r of budgets_returned(group_budgets, leaving)) {
        const b = group_budgets.find((x) => x.id === r.budget_id);
        const view = ((_a = planned[_c = r.to_owner_key]) !== null && _a !== void 0 ? _a : (planned[_c] = [...((_b = me_budgets[r.to_owner_key]) !== null && _b !== void 0 ? _b : [])]));
        const { kept_category_ids, removed_category_ids } = (0, category_ownership_service_1.plan_view_arrival)({
            budget_id: b.id,
            category_ids: b.category_ids,
            view_budgets: view,
            first_of,
        });
        view.push(Object.assign(Object.assign({}, b), { owner_key: r.to_owner_key, category_ids: kept_category_ids }));
        out.push({
            budget_id: b.id,
            name: b.name,
            to_owner_key: r.to_owner_key,
            category_ids: kept_category_ids,
            removed_category_ids,
            // Only a budget THIS return emptied (one that never had categories isn't touched).
            paused: kept_category_ids.length === 0 && removed_category_ids.length > 0,
        });
    }
    return out;
}
/** The changed returns that landed in `user_id`'s Me view — what that person is told. PURE. */
function returned_budget_notes(returns, user_id) {
    return returns
        .filter((r) => r.to_owner_key === user_id && r.removed_category_ids.length > 0)
        .map((r) => ({
        budget_id: r.budget_id,
        name: r.name,
        removed_category_ids: r.removed_category_ids,
        paused: r.paused,
    }));
}
//# sourceMappingURL=budget_view.service.js.map