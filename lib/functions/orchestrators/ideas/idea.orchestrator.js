"use strict";
/**
 * Ideas orchestrators (Planning-Module v1)
 *
 * Every write: flag check → resolver (who owns the list, may the caller use it) → domain plan
 * inside the repo transaction → one atomic write. Client-made ids (idea, comment) make retries
 * safe: a retried create / comment finds its own doc and returns without writing.
 *
 * An idea the caller can't see answers NOT_FOUND (never "it exists but isn't yours").
 *
 * @module orchestrators/ideas/idea
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_idea_orchestrator = create_idea_orchestrator;
exports.update_idea_orchestrator = update_idea_orchestrator;
exports.delete_idea_orchestrator = delete_idea_orchestrator;
exports.react_to_idea_orchestrator = react_to_idea_orchestrator;
exports.get_ideas_capabilities_orchestrator = get_ideas_capabilities_orchestrator;
const observability_1 = require("../../observability");
const idea_repo_1 = require("../../repositories/idea.repo");
const idea_resolver_1 = require("../../resolvers/ideas/idea.resolver");
const idea_service_1 = require("../../domain/ideas/idea.service");
const budget_view_service_1 = require("../../domain/sharing/budget_view.service");
const OFF = {
    success: false,
    code: "FEATURE_DISABLED",
    message: "Ideas aren't available yet.",
};
const NOT_FOUND = {
    success: false,
    code: "NOT_FOUND",
    message: "This idea isn't available.",
};
function to_outcome(plan) {
    return plan.kind === "rejected"
        ? { success: false, code: plan.code, message: plan.message }
        : { success: true, data: plan.result };
}
/** The idea's owner key when the caller may use its list; null = treat as not found. */
async function resolve_usable_list(ctx, idea_id, user_id) {
    const idea = await (0, idea_resolver_1.resolve_idea)(ctx, idea_id);
    if (!idea)
        return null;
    const group = await (0, idea_resolver_1.resolve_list_group)(ctx, idea.owner_key);
    return (0, idea_service_1.can_use_list)(idea.owner_key, user_id, group) ? idea.owner_key : null;
}
function with_idea(owner_key, fn) {
    return (snap) => {
        if (!snap.idea || snap.idea.owner_key !== owner_key) {
            return { kind: "rejected", code: "NOT_FOUND", message: "This idea isn't available." };
        }
        return fn(Object.assign(Object.assign({}, snap), { idea: snap.idea }));
    };
}
async function create_idea_orchestrator(ctx, now_ms = Date.now()) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "create_idea");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    if (!(await (0, idea_resolver_1.resolve_ideas_enabled)(ctx, ctx.user_id)))
        return OFF;
    (0, idea_resolver_1.resolve_idea_dependencies)(ctx);
    const owner_key = ctx.input.view_group_id
        ? (0, budget_view_service_1.group_view_key)(ctx.input.view_group_id)
        : ctx.user_id;
    const group = await (0, idea_resolver_1.resolve_list_group)(ctx, owner_key);
    if (!(0, idea_service_1.can_use_list)(owner_key, ctx.user_id, group)) {
        return { success: false, code: "PERMISSION_DENIED", message: "You're not in this group." };
    }
    const open_count = await (0, idea_resolver_1.resolve_open_count)(ctx, owner_key);
    const plan = await idea_repo_1.idea_repo.apply_in_transaction(ctx, { idea_id: ctx.input.idea_id, owner_key }, (snap) => {
        const c = { owner_key, actor_id: ctx.user_id, now_ms, open_count };
        return (0, idea_service_1.plan_create)(ctx.input, c, snap.idea, snap.topics);
    });
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return to_outcome(plan);
}
async function update_idea_orchestrator(ctx, now_ms = Date.now()) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", `update_idea:${ctx.input.action}`);
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    if (!(await (0, idea_resolver_1.resolve_ideas_enabled)(ctx, ctx.user_id)))
        return OFF;
    (0, idea_resolver_1.resolve_idea_dependencies)(ctx);
    const owner_key = await resolve_usable_list(ctx, ctx.input.idea_id, ctx.user_id);
    if (!owner_key)
        return NOT_FOUND;
    const input = ctx.input;
    const open_count = input.action === "restore" ? await (0, idea_resolver_1.resolve_open_count)(ctx, owner_key) : 0;
    const plan = await idea_repo_1.idea_repo.apply_in_transaction(ctx, { idea_id: input.idea_id, owner_key }, with_idea(owner_key, ({ idea, topics }) => {
        switch (input.action) {
            case "edit":
                return (0, idea_service_1.plan_edit)(idea, input.fields, ctx.user_id, now_ms, topics);
            case "convert":
                return (0, idea_service_1.plan_convert)(idea, input.converted_to, ctx.user_id, now_ms, topics);
            case "restore":
                return (0, idea_service_1.plan_restore)(idea, ctx.user_id, now_ms, topics, open_count);
        }
    }));
    // The comments follow the idea: they expire with a converted idea, and stay when restored.
    if (plan.kind === "write" && plan.idea && input.action !== "edit") {
        await idea_repo_1.idea_repo.set_comments_expiry(ctx, input.idea_id, owner_key, plan.idea.expire_at_ms);
    }
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return to_outcome(plan);
}
async function delete_idea_orchestrator(ctx) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "delete_idea");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    if (!(await (0, idea_resolver_1.resolve_ideas_enabled)(ctx, ctx.user_id)))
        return OFF;
    (0, idea_resolver_1.resolve_idea_dependencies)(ctx);
    const owner_key = await resolve_usable_list(ctx, ctx.input.idea_id, ctx.user_id);
    // Already gone (or never visible): deleting is done either way.
    if (!owner_key)
        return { success: true, data: { idea_id: ctx.input.idea_id, deleted: false } };
    // Comments first: if this fails the idea is still here, so a retry finds it and cleans up.
    await idea_repo_1.idea_repo.delete_comments(ctx, ctx.input.idea_id, owner_key);
    const plan = await idea_repo_1.idea_repo.apply_in_transaction(ctx, { idea_id: ctx.input.idea_id, owner_key }, (snap) => {
        const same_list = snap.idea && snap.idea.owner_key === owner_key ? snap.idea : null;
        return (0, idea_service_1.plan_delete)(ctx.input.idea_id, same_list, snap.topics);
    });
    // A comment posted in between would be left behind: sweep once more (best effort).
    if (plan.kind === "write") {
        await idea_repo_1.idea_repo.delete_comments(ctx, ctx.input.idea_id, owner_key).catch(() => 0);
    }
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return to_outcome(plan);
}
async function react_to_idea_orchestrator(ctx, now_ms = Date.now()) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", `react_to_idea:${ctx.input.action}`);
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    if (!(await (0, idea_resolver_1.resolve_ideas_enabled)(ctx, ctx.user_id)))
        return OFF;
    (0, idea_resolver_1.resolve_idea_dependencies)(ctx);
    const owner_key = await resolve_usable_list(ctx, ctx.input.idea_id, ctx.user_id);
    if (!owner_key)
        return NOT_FOUND;
    const input = ctx.input;
    const comment_id = input.action === "like" ? undefined : input.comment_id;
    const plan = await idea_repo_1.idea_repo.apply_in_transaction(ctx, { idea_id: input.idea_id, owner_key, comment_id }, with_idea(owner_key, ({ idea, comment }) => {
        switch (input.action) {
            case "like":
                return (0, idea_service_1.plan_like)(idea, ctx.user_id, input.liked, now_ms);
            case "comment":
                return (0, idea_service_1.plan_comment)(idea, input.comment_id, input.text, comment, ctx.user_id, now_ms);
            case "delete_comment":
                return (0, idea_service_1.plan_delete_comment)(idea, input.comment_id, comment, ctx.user_id);
        }
    }));
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return to_outcome(plan);
}
/** The app can't read `_feature_flags`, so it asks. Returns ONLY `{enabled}`. */
async function get_ideas_capabilities_orchestrator(ctx, user_id) {
    return { enabled: await (0, idea_resolver_1.resolve_ideas_enabled)(ctx, user_id) };
}
//# sourceMappingURL=idea.orchestrator.js.map