"use strict";
/**
 * Group Orchestrators (D4, D24–D26, D30)
 *
 * create_group: creates the group (caller = owner) and sends join requests.
 * add_to_group: sends a join request to a connected person.
 * respond_to_request: accept (joins atomically) or decline.
 * manage_group: rename / remove_member / transfer_ownership / leave / delete.
 *
 * Joining never happens without the invitee's Accept (D25).
 *
 * @module orchestrators/sharing/groups
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_group_orchestrator = create_group_orchestrator;
exports.add_to_group_orchestrator = add_to_group_orchestrator;
exports.respond_to_request_orchestrator = respond_to_request_orchestrator;
exports.manage_group_orchestrator = manage_group_orchestrator;
const observability_1 = require("../../observability");
const sharing_resolver_1 = require("../../resolvers/sharing/sharing.resolver");
const placement_service_1 = require("../../domain/sharing/placement.service");
const account_repo_1 = require("../../repositories/account.repo");
const group_service_1 = require("../../domain/sharing/group.service");
const request_service_1 = require("../../domain/sharing/request.service");
const connection_service_1 = require("../../domain/sharing/connection.service");
const sharing_1 = require("../../repositories/sharing");
const group_everything_else_1 = require("./group_everything_else");
const budget_view_orchestrator_1 = require("./budget_view.orchestrator");
const versions_1 = require("./versions");
const view_reassign_1 = require("./view_reassign");
const idea_repo_1 = require("../../repositories/idea.repo");
const budget_view_service_1 = require("../../domain/sharing/budget_view.service");
const fail = (errors) => ({
    success: false,
    errors: errors && errors.length ? errors : ["Something went wrong"],
});
/** Pure: the join requests to send, or the reasons they can't be sent. */
function plan_invites(group, caller_id, invitee_ids, deps, pending_to, now_ms) {
    var _a, _b;
    const errors = [];
    const to_send = invitee_ids.filter((uid) => !pending_to.has(uid));
    for (const uid of to_send) {
        errors.push(...(0, group_service_1.validate_invite)(group, caller_id, uid, (0, connection_service_1.is_connected)((_b = (_a = deps.connections[uid]) === null || _a === void 0 ? void 0 : _a.status) !== null && _b !== void 0 ? _b : null)));
    }
    errors.push(...(0, request_service_1.check_daily_recipient_limit)(deps.sent_today, to_send, now_ms));
    if (errors.length)
        return { validation_errors: [...new Set(errors)] };
    return {
        entities: to_send.map((uid) => (0, request_service_1.build_join_request)(sharing_1.request_repo.new_id(), caller_id, uid, group.id, now_ms)),
    };
}
/** Creates a group and invites connected people. */
async function create_group_orchestrator(ctx) {
    var _a, _b, _c, _d;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "create_group");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    const now_ms = Date.now();
    const group_id = sharing_1.group_repo.new_id();
    const invitees = [...new Set(ctx.input.invitee_ids)].filter((u) => u !== ctx.user_id);
    // 1. RESOLVER
    const deps = await (0, sharing_resolver_1.resolve_invites)(ctx, ctx.user_id, null, invitees, now_ms);
    // 2. DOMAIN: check the invites against the would-be group before creating it
    const preview = (0, group_service_1.build_group)(group_id, ctx.input.name, ctx.user_id, 0, now_ms);
    if (((_a = preview.validation_errors) === null || _a === void 0 ? void 0 : _a.length) || !preview.entity)
        return fail(preview.validation_errors);
    const invites = plan_invites(preview.entity.group, ctx.user_id, invitees, deps, new Set(), now_ms);
    if ((_b = invites.validation_errors) === null || _b === void 0 ? void 0 : _b.length)
        return fail(invites.validation_errors);
    // 3. REPOSITORY: group + owner's groupIds atomically (limit re-checked on fresh data)
    const created = await sharing_1.group_repo.apply_mutation(ctx, group_id, [ctx.user_id], (_group, counts) => { var _a; return (0, group_service_1.build_group)(group_id, ctx.input.name, ctx.user_id, (_a = counts[ctx.user_id]) !== null && _a !== void 0 ? _a : 0, now_ms); }, now_ms);
    if ((_c = created.validation_errors) === null || _c === void 0 ? void 0 : _c.length)
        return fail(created.validation_errors);
    await sharing_1.request_repo.save_many(ctx, (_d = invites.entities) !== null && _d !== void 0 ? _d : []);
    await (0, group_everything_else_1.ensure_group_everything_else)(ctx, group_id);
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return { success: true, group_id };
}
/** Sends a join request to someone the caller is connected with. */
async function add_to_group_orchestrator(ctx) {
    var _a, _b;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "add_to_group");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    const now_ms = Date.now();
    // 1. RESOLVER
    const deps = await (0, sharing_resolver_1.resolve_invites)(ctx, ctx.user_id, ctx.input.group_id, [ctx.input.invitee_id], now_ms);
    const pending = (await (0, sharing_resolver_1.resolve_group_pending_requests)(ctx, ctx.input.group_id))
        .filter((r) => (0, request_service_1.is_open)(r, now_ms));
    const pending_to = new Set(pending.map((r) => r.to_user_id));
    // 2. DOMAIN
    if (pending_to.has(ctx.input.invitee_id)) {
        return fail(["They already have an invite to this group"]);
    }
    const invites = plan_invites(deps.group, ctx.user_id, [ctx.input.invitee_id], deps, pending_to, now_ms);
    if ((_a = invites.validation_errors) === null || _a === void 0 ? void 0 : _a.length)
        return fail(invites.validation_errors);
    // 3. REPOSITORY
    await sharing_1.request_repo.save_many(ctx, (_b = invites.entities) !== null && _b !== void 0 ? _b : []);
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return { success: true, group_id: ctx.input.group_id };
}
/** Accepts or declines a request addressed to the caller. */
async function respond_to_request_orchestrator(ctx) {
    var _a, _b, _c, _d;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "respond_to_request");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    const now_ms = Date.now();
    // 1. RESOLVER
    const { request, inviter_connection } = await (0, sharing_resolver_1.resolve_request)(ctx, ctx.input.request_id);
    // 2. DOMAIN
    const answered = (0, request_service_1.answer_request)(request, ctx.user_id, ctx.input.accept, now_ms);
    if (((_a = answered.validation_errors) === null || _a === void 0 ? void 0 : _a.length) || !answered.entity) {
        return fail(answered.validation_errors);
    }
    const answer = answered.entity;
    if (ctx.input.accept && !(0, connection_service_1.is_connected)((_b = inviter_connection === null || inviter_connection === void 0 ? void 0 : inviter_connection.status) !== null && _b !== void 0 ? _b : null)) {
        return fail(["This request isn't available"]);
    }
    // 3. REPOSITORY
    if (!ctx.input.accept) {
        await sharing_1.request_repo.save_many(ctx, [answer]);
        (0, observability_1.log_operation_success)(span, ctx.user_id);
        return { success: true, group_id: answer.group_id };
    }
    if (answer.type === "share_account") {
        // First Accept from any member applies the share (PD5); the other members'
        // copies of the request are cancelled.
        const deps = await (0, sharing_resolver_1.resolve_share_accept)(ctx, answer);
        const placement = (0, placement_service_1.placement_on_accept)(answer, deps.account, deps.group, now_ms);
        if (((_c = placement.validation_errors) === null || _c === void 0 ? void 0 : _c.length) || !placement.entity) {
            return fail(placement.validation_errors);
        }
        const siblings = (0, request_service_1.cancel_requests)(deps.pending.filter((r) => r.id !== answer.id), now_ms);
        if (!deps.account.placement) {
            await account_repo_1.account_repo.set_placement(ctx, deps.account.id, placement.entity, answer.from_user_id);
            await (0, versions_1.bump_owner_versions)([answer.from_user_id]);
            await (0, view_reassign_1.reassign_accounts)(ctx, [{ id: deps.account.id, user_id: answer.from_user_id }]);
            await (0, view_reassign_1.refresh_group_transfer_roles)(ctx, placement.entity.group_id);
        }
        await sharing_1.request_repo.save_many(ctx, [answer, ...siblings]);
        (0, observability_1.log_operation_success)(span, ctx.user_id);
        return { success: true, group_id: answer.group_id };
    }
    const joined = await sharing_1.group_repo.apply_mutation(ctx, answer.group_id, [ctx.user_id], (group, counts) => { var _a; return (0, group_service_1.accept_join)(group, ctx.user_id, (_a = counts[ctx.user_id]) !== null && _a !== void 0 ? _a : 0, now_ms); }, now_ms, (tx) => sharing_1.request_repo.set_in_transaction(tx, answer));
    if ((_d = joined.validation_errors) === null || _d === void 0 ? void 0 : _d.length)
        return fail(joined.validation_errors);
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return { success: true, group_id: answer.group_id };
}
/**
 * Owner / member group management. Leaving / removal / deletion also make the
 * departing people's shared accounts private again and cancel their pending
 * requests, and budgets they moved in go back to their Me view (D13).
 */
async function manage_group_orchestrator(ctx) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "manage_group");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    const now_ms = Date.now();
    const input = ctx.input;
    const caller = ctx.user_id;
    // 1. RESOLVER (the group itself is read inside the transaction below)
    const departs = input.action === "delete" || input.action === "leave" || input.action === "remove_member";
    const [pending, group_accounts] = departs
        ? await Promise.all([
            (0, sharing_resolver_1.resolve_group_pending_requests)(ctx, input.group_id),
            (0, sharing_resolver_1.resolve_group_accounts)(ctx, input.group_id),
        ])
        : [[], []];
    // 2. DOMAIN rule (run on fresh data inside the transaction)
    const rule = (group) => {
        switch (input.action) {
            case "rename": return (0, group_service_1.rename_group)(group, caller, input.name);
            case "remove_member": return (0, group_service_1.remove_member)(group, caller, input.user_id);
            case "transfer_ownership": return (0, group_service_1.transfer_ownership)(group, caller, input.user_id);
            case "leave": return (0, group_service_1.leave_group)(group, caller, now_ms);
            case "delete": return (0, group_service_1.delete_group)(group, caller, now_ms);
        }
    };
    // 3. REPOSITORY
    const result = await sharing_1.group_repo.apply_mutation(ctx, input.group_id, [], rule, now_ms);
    if (((_a = result.validation_errors) === null || _a === void 0 ? void 0 : _a.length) || !result.entity)
        return fail(result.validation_errors);
    // 4. DEPARTURES (D13): who left decides which accounts / requests are released.
    if (departs) {
        const deleted = result.entity.group.deleted_at_ms !== null;
        const leaving = deleted
            ? "all"
            : result.entity.user_changes.filter((c) => c.remove).map((c) => c.user_id);
        const released = (0, placement_service_1.placements_released)(group_accounts, input.group_id, leaving);
        await account_repo_1.account_repo.clear_placements(ctx, released, caller);
        await (0, versions_1.bump_owner_versions)(group_accounts.filter((a) => released.includes(a.id)).map((a) => a.user_id));
        await (0, view_reassign_1.reassign_accounts)(ctx, group_accounts.filter((a) => released.includes(a.id)));
        // The members who stay (and those who left) re-decide which transfers cross the group.
        await (0, view_reassign_1.refresh_group_transfer_roles)(ctx, input.group_id, result.entity.user_changes.filter((c) => c.remove).map((c) => c.user_id));
        await sharing_1.request_repo.save_many(ctx, (0, request_service_1.cancel_requests)((0, placement_service_1.requests_released)(pending, leaving), now_ms));
        await (0, budget_view_orchestrator_1.return_moved_in_budgets)(ctx, input.group_id, leaving, caller);
        // A closed group's ideas have nobody left to read them (Planning-Module v1).
        if (deleted)
            await idea_repo_1.idea_repo.delete_list(ctx, (0, budget_view_service_1.group_view_key)(input.group_id));
    }
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return { success: true, group_id: input.group_id };
}
//# sourceMappingURL=groups.orchestrator.js.map