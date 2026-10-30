"use strict";
/**
 * Account Placement Orchestrators (P1, D7, N9, I4, D25)
 *
 * share_account: the owner shares an account with a group (requests to the
 * other members, or applied at once in a group of one).
 * unshare_account: the owner makes it private again (no Accept needed).
 *
 * Accepting a share request lives in respond_to_request (groups orchestrator).
 *
 * @module orchestrators/sharing/placement
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.share_account_orchestrator = share_account_orchestrator;
exports.unshare_account_orchestrator = unshare_account_orchestrator;
const observability_1 = require("../../observability");
const sharing_resolver_1 = require("../../resolvers/sharing/sharing.resolver");
const placement_service_1 = require("../../domain/sharing/placement.service");
const request_service_1 = require("../../domain/sharing/request.service");
const names_service_1 = require("../../domain/sharing/names.service");
const account_repo_1 = require("../../repositories/account.repo");
const sharing_1 = require("../../repositories/sharing");
const versions_1 = require("./versions");
const view_reassign_1 = require("./view_reassign");
/** Shares an account with a group. */
async function share_account_orchestrator(ctx) {
    var _a, _b, _c;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "share_account");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    const now_ms = Date.now();
    // 1. RESOLVER
    const deps = await (0, sharing_resolver_1.resolve_share_account)(ctx, ctx.user_id, ctx.input.account_id, ctx.input.group_id, now_ms);
    // 2. DOMAIN
    const plan = (0, placement_service_1.plan_share_account)({
        account: deps.account,
        caller_id: ctx.user_id,
        group: deps.group,
        include_history: ctx.input.include_history,
        share_from_ms: (_a = ctx.input.share_from_ms) !== null && _a !== void 0 ? _a : null,
        group_accounts: deps.group_accounts,
        pending_for_account: deps.pending_for_account,
        sent_today: deps.sent_today,
        now_ms,
        new_request_id: () => sharing_1.request_repo.new_id(),
    });
    if (((_b = plan.validation_errors) === null || _b === void 0 ? void 0 : _b.length) || !plan.entity) {
        const dup = (_c = plan.entity) === null || _c === void 0 ? void 0 : _c.duplicate_owner_id;
        return {
            success: false,
            errors: plan.validation_errors,
            already_shared_by: dup ? (0, names_service_1.person_view)(dup, {}) : undefined,
        };
    }
    // 3. REPOSITORY
    if (plan.entity.placement) {
        await account_repo_1.account_repo.set_placement(ctx, ctx.input.account_id, plan.entity.placement, ctx.user_id);
        await (0, versions_1.bump_owner_versions)([ctx.user_id]);
        await (0, view_reassign_1.reassign_accounts)(ctx, [{ id: ctx.input.account_id, user_id: ctx.user_id }]);
        await (0, view_reassign_1.refresh_group_transfer_roles)(ctx, plan.entity.placement.group_id);
    }
    await sharing_1.request_repo.save_many(ctx, plan.entity.requests);
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return { success: true, status: plan.entity.placement ? "shared" : "requested" };
}
/** Makes a shared account private again; cancels any pending share requests. */
async function unshare_account_orchestrator(ctx) {
    var _a, _b;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "unshare_account");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    const now_ms = Date.now();
    // 1. RESOLVER
    const { account, pending } = await (0, sharing_resolver_1.resolve_account_placement)(ctx, ctx.input.account_id);
    // 2. DOMAIN
    const mine = account && account.user_id === ctx.user_id;
    const plan = (0, placement_service_1.plan_unshare_account)(account, ctx.user_id);
    const cancelled = mine ? (0, request_service_1.cancel_requests)(pending, now_ms) : [];
    if ((((_a = plan.validation_errors) === null || _a === void 0 ? void 0 : _a.length) || !plan.entity) && cancelled.length === 0) {
        return { success: false, errors: plan.validation_errors };
    }
    // 3. REPOSITORY (cancelling a pending share counts as unsharing too)
    if (plan.entity) {
        await account_repo_1.account_repo.set_placement(ctx, ctx.input.account_id, null, ctx.user_id);
        await (0, versions_1.bump_owner_versions)([ctx.user_id]);
        await (0, view_reassign_1.reassign_accounts)(ctx, [{ id: ctx.input.account_id, user_id: ctx.user_id }]);
        await (0, view_reassign_1.refresh_group_transfer_roles)(ctx, (_b = account === null || account === void 0 ? void 0 : account.placement) === null || _b === void 0 ? void 0 : _b.group_id);
    }
    await sharing_1.request_repo.save_many(ctx, cancelled);
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return { success: true };
}
//# sourceMappingURL=placement.orchestrator.js.map