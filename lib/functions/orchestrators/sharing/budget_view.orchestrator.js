"use strict";
/**
 * Budget View Orchestrators (D9, D32, D13; PD6)
 *
 * move_budget: Me ↔ group. The budget keeps its id, settings and periods; its
 *   owner key changes (budget + every period). Moving out of Me re-runs the
 *   assignment engine on the mover's transactions that pointed at it.
 * copy_budgets_to_group: new group budgets with the same settings; originals
 *   stay (or move, with remove_from_me). Clashes come back as conflicts.
 * return_moved_in_budgets: on leave / removal / delete, budgets someone moved
 *   in go back to their Me view.
 *
 * @module orchestrators/sharing/budget_view
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.move_budget_orchestrator = move_budget_orchestrator;
exports.copy_budgets_to_group_orchestrator = copy_budgets_to_group_orchestrator;
exports.return_moved_in_budgets = return_moved_in_budgets;
const budget_checklist_repo_1 = require("../../repositories/budget_checklist.repo");
const category_catalog_resolver_1 = require("../../resolvers/shared/category_catalog.resolver");
const crypto_1 = require("crypto");
const observability_1 = require("../../observability");
const budget_view_service_1 = require("../../domain/sharing/budget_view.service");
const budget_repo_1 = require("../../repositories/budget.repo");
const budget_period_repo_1 = require("../../repositories/budget_period.repo");
const sharing_1 = require("../../repositories/sharing");
const create_budget_orchestrator_1 = require("../budgets/create_budget.orchestrator");
const group_everything_else_1 = require("./group_everything_else");
const versions_1 = require("./versions");
const view_reassign_1 = require("./view_reassign");
const job_queue_1 = require("../../infrastructure/job_queue");
const budget_pause_service_1 = require("../../domain/budgets/budget_pause.service");
/** Repo budget → the fields the view rules need. */
function to_view_budget(b) {
    var _a, _b;
    if (!b)
        return null;
    return {
        id: b.id,
        owner_key: b.user_id,
        name: b.name,
        amount: b.amount,
        category_ids: (_a = b.category_ids) !== null && _a !== void 0 ? _a : [],
        is_everything_else: b.is_system_everything_else === true,
        brought_by: (_b = b.brought_by) !== null && _b !== void 0 ? _b : null,
        is_manual: b.is_manual === true,
    };
}
/** Stored category id → the first category it means (slugs map to themselves). */
async function first_of_fn(ctx) {
    const catalog = await (0, category_catalog_resolver_1.load_category_catalog)(ctx);
    return (id) => { var _a, _b; return (_b = (_a = catalog.slugs_by_plaid[id]) === null || _a === void 0 ? void 0 : _a.first_category_id) !== null && _b !== void 0 ? _b : id; };
}
async function load_view_budgets(ctx, owner_key) {
    const budgets = await budget_repo_1.budget_repo.get_by_user_id(ctx, owner_key);
    return budgets.map((b) => to_view_budget(b));
}
/** Applies a move: budget + periods re-keyed; the old owner's pinned splits re-assigned. */
async function apply_move(ctx, budget, new_owner_key, brought_by, actor_id) {
    const old_owner_key = budget.owner_key;
    await budget_repo_1.budget_repo.set_owner(ctx, budget.id, new_owner_key, brought_by, actor_id);
    await budget_period_repo_1.budget_period_repo.set_owner_for_budget(ctx, budget.id, new_owner_key);
    await budget_checklist_repo_1.budget_checklist_repo.set_owner(budget.id, new_owner_key);
    // The budget write bumped both keys BEFORE its periods were re-keyed; a derive in between
    // cached the budget without its stored periods (rollover / edited amounts). Bump again.
    await (0, versions_1.bump_owner_versions)([old_owner_key, new_owner_key]);
    const to_group = (0, budget_view_service_1.group_id_of_key)(new_owner_key);
    if (to_group)
        await (0, group_everything_else_1.ensure_group_everything_else)(ctx, to_group);
    // Both views' budgets changed: re-assign everything that counts in either (H6) — the bounded
    // engine, after the target view has its Everything Else.
    await (0, view_reassign_1.reassign_view)(ctx, old_owner_key);
    await (0, view_reassign_1.reassign_view)(ctx, new_owner_key);
}
/** Moves a budget between Me and a group. `to_group_id: null` = to Me. */
async function move_budget_orchestrator(ctx) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "move_budget");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    // 1. RESOLVER
    const budget = to_view_budget(await budget_repo_1.budget_repo.get_by_id(ctx, ctx.input.budget_id));
    const source_gid = budget ? (0, budget_view_service_1.group_id_of_key)(budget.owner_key) : null;
    const [source_group, target_group] = await Promise.all([
        source_gid ? sharing_1.group_repo.get(ctx, source_gid) : Promise.resolve(null),
        ctx.input.to_group_id
            ? sharing_1.group_repo.get(ctx, ctx.input.to_group_id)
            : Promise.resolve(null),
    ]);
    const target_key = ctx.input.to_group_id
        ? (0, budget_view_service_1.group_view_key)(ctx.input.to_group_id)
        : ctx.user_id;
    const target_budgets = await load_view_budgets(ctx, target_key);
    // 2. DOMAIN
    const plan = (0, budget_view_service_1.plan_move_budget)(budget, ctx.user_id, source_group, ctx.input.to_group_id ? { type: "group", group: target_group } : { type: "me" }, target_budgets, await first_of_fn(ctx));
    if (((_a = plan.validation_errors) === null || _a === void 0 ? void 0 : _a.length) || !plan.entity) {
        return { success: false, errors: plan.validation_errors };
    }
    // 3. REPOSITORY
    await apply_move(ctx, budget, plan.entity.new_owner_key, plan.entity.brought_by, ctx.user_id);
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return { success: true, budget_ids: [budget.id] };
}
/** Copies (or moves) the caller's budgets into a group (D32). */
async function copy_budgets_to_group_orchestrator(ctx) {
    var _a, _b, _c;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "copy_budgets_to_group");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    const { group_id, items, remove_from_me } = ctx.input;
    // 1. RESOLVER
    const [group, mine, group_budgets] = await Promise.all([
        sharing_1.group_repo.get(ctx, group_id),
        budget_repo_1.budget_repo.get_by_user_id(ctx, ctx.user_id),
        load_view_budgets(ctx, (0, budget_view_service_1.group_view_key)(group_id)),
    ]);
    const by_id = new Map(mine.map((b) => [b.id, b]));
    // 2. DOMAIN
    const plan = (0, budget_view_service_1.plan_copy_budgets)(group, ctx.user_id, items.map((i) => {
        var _a;
        return ({
            budget: to_view_budget((_a = by_id.get(i.budget_id)) !== null && _a !== void 0 ? _a : null),
            amount: i.amount,
        });
    }), group_budgets, await first_of_fn(ctx), !remove_from_me // a move keeps the whole budget — it can't move half its categories
    );
    if (((_a = plan.validation_errors) === null || _a === void 0 ? void 0 : _a.length) || !plan.entity) {
        return { success: false, errors: plan.validation_errors };
    }
    // 3. REPOSITORY
    const created = [];
    for (const { source, amount, category_ids } of plan.entity.creates) {
        if (remove_from_me) {
            // A move keeps the budget's id, amount and history (the chosen amount only
            // applies to copies; the app shows the current amount when moving).
            await apply_move(ctx, source, (0, budget_view_service_1.group_view_key)(group_id), ctx.user_id, ctx.user_id);
            created.push(source.id);
            continue;
        }
        const original = by_id.get(source.id);
        const res = await (0, create_budget_orchestrator_1.create_budget_orchestrator)(ctx, ctx.user_id, (0, crypto_1.randomUUID)(), {
            name: original.name,
            description: original.description,
            amount,
            category_ids: category_ids !== null && category_ids !== void 0 ? category_ids : original.category_ids,
            is_manual: original.is_manual === true,
            period: original.period,
            budget_type: original.budget_type,
            start_date: original.start_date.toDate().toISOString(),
            alert_threshold: (_b = original.alert_threshold) !== null && _b !== void 0 ? _b : 80,
            is_shared: false,
            view_group_id: group_id,
            is_ongoing: (_c = original.is_ongoing) !== null && _c !== void 0 ? _c : true,
            budget_end_date: original.budget_end_date
                ? original.budget_end_date.toDate().toISOString()
                : undefined,
        });
        created.push(res.budget_id);
    }
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return {
        success: true,
        budget_ids: created,
        conflicts: plan.entity.conflicts,
        skipped: plan.entity.skipped,
    };
}
/** Stored-spent days to recompute after an emptied budget is paused from today (≤ one period). */
const RETURN_RECOMPUTE_DAYS = 31;
/** Pauses a returned, emptied budget from today on (compare-and-set, retried on a race). */
async function pause_returned_budget(ctx, budget_id, range, actor_id) {
    var _a, _b;
    for (let attempt = 0; attempt < 3; attempt++) {
        const current = (_b = (_a = (await budget_repo_1.budget_repo.get_by_id(ctx, budget_id))) === null || _a === void 0 ? void 0 : _a.paused_ranges) !== null && _b !== void 0 ? _b : [];
        const next = (0, budget_pause_service_1.apply_pause_change)(current, range.start_day, range.end_day, true);
        if (await budget_repo_1.budget_repo.replace_paused_ranges_if_unchanged(ctx, budget_id, current, next, actor_id)) {
            return;
        }
    }
    throw new Error(`pause_returned_budget(${budget_id}): the budget kept changing`);
}
/**
 * D13: budgets the leaving people moved in go back to their Me view. Called by
 * manage_group (leave / remove / delete) and account purge. Never throws.
 *
 * S1-M4 (user decision 2026-11-02): each lands in a Me view that may already budget some of its
 * categories (made while it sat in the group). The Me budget keeps them; the returning budget
 * comes back without them (category_ownership.plan_view_arrival, canon A3) — and PAUSED from
 * today when nothing is left, so it takes nothing from Everything Else. Nothing is deleted.
 * Categories / pause are written BEFORE the move, whose final derive bump covers them.
 *
 * @returns every return, with what changed (the caller tells the person concerned)
 */
async function return_moved_in_budgets(ctx, group_id, leaving, actor_id) {
    const done = [];
    try {
        const group_budgets = await load_view_budgets(ctx, (0, budget_view_service_1.group_view_key)(group_id));
        const owners = [...new Set((0, budget_view_service_1.budgets_returned)(group_budgets, leaving).map((r) => r.to_owner_key))];
        if (owners.length === 0)
            return done;
        const me_views = await Promise.all(owners.map((o) => load_view_budgets(ctx, o)));
        const me_budgets = {};
        owners.forEach((o, i) => (me_budgets[o] = me_views[i]));
        const returns = (0, budget_view_service_1.plan_budget_returns)(group_budgets, leaving, me_budgets, await first_of_fn(ctx));
        const now_ms = Date.now();
        for (const r of returns) {
            try {
                const b = group_budgets.find((x) => x.id === r.budget_id);
                if (r.removed_category_ids.length > 0) {
                    await budget_repo_1.budget_repo.set_category_ids(ctx, r.budget_id, r.category_ids, actor_id);
                }
                if (r.paused)
                    await pause_returned_budget(ctx, r.budget_id, (0, budget_view_service_1.return_pause_range)(now_ms), actor_id);
                await apply_move(ctx, Object.assign(Object.assign({}, b), { category_ids: r.category_ids }), r.to_owner_key, null, actor_id);
                if (r.paused) {
                    // The stored spent of the period holding today leaves the paused days out (PZ6).
                    const today = (0, budget_pause_service_1.iso_from_day)((0, budget_pause_service_1.utc_day)(now_ms));
                    const until = (0, budget_pause_service_1.iso_from_day)((0, budget_pause_service_1.utc_day)(now_ms) + RETURN_RECOMPUTE_DAYS);
                    await (0, job_queue_1.create_job)("recompute_budget_spent", {
                        user_id: r.to_owner_key,
                        budget_ids: [r.budget_id],
                        dates_ms_by_budget: { [r.budget_id]: (0, budget_pause_service_1.pause_recompute_dates)(today, until) },
                        force_rollover: true,
                    }, { trace_id: ctx.trace_id }).catch((e) => console.error(`[${ctx.trace_id}] return recompute enqueue failed:`, e));
                }
                done.push(r);
            }
            catch (error) {
                console.error(`[${ctx.trace_id}] return_moved_in_budgets(${group_id}) budget ${r.budget_id} failed:`, error instanceof Error ? error.message : error);
            }
        }
        return done;
    }
    catch (error) {
        console.error(`[${ctx.trace_id}] return_moved_in_budgets(${group_id}) failed:`, error instanceof Error ? error.message : error);
        return done;
    }
}
//# sourceMappingURL=budget_view.orchestrator.js.map