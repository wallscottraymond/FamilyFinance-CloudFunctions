"use strict";
/**
 * Departure Orchestrator (D13) — used by account purge.
 *
 * Takes a user out of every group the same way leaving does (the departing
 * person's accounts stop counting; their solo groups close), and removes their
 * connections and connect code. Owned groups that still have other members must
 * be handed over first; purge blocks on those before it gets here.
 *
 * Requests from / to the user are hard-deleted by the purge sweep itself.
 *
 * @module orchestrators/sharing/departure
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.release_user_from_sharing = release_user_from_sharing;
const group_service_1 = require("../../domain/sharing/group.service");
const placement_service_1 = require("../../domain/sharing/placement.service");
const request_service_1 = require("../../domain/sharing/request.service");
const sharing_resolver_1 = require("../../resolvers/sharing/sharing.resolver");
const sharing_1 = require("../../repositories/sharing");
const account_repo_1 = require("../../repositories/account.repo");
const budget_view_orchestrator_1 = require("./budget_view.orchestrator");
const versions_1 = require("./versions");
const view_reassign_1 = require("./view_reassign");
const idea_repo_1 = require("../../repositories/idea.repo");
const budget_view_service_1 = require("../../domain/sharing/budget_view.service");
/** Removes a user from all sharing. Idempotent: re-running finds nothing left. */
async function release_user_from_sharing(ctx, user_id) {
    var _a;
    const now_ms = Date.now();
    const result = {
        groups_left: 0, groups_closed: 0, connections_removed: 0, blocked_group_ids: [],
    };
    // 1. RESOLVER
    const groups = await sharing_1.group_repo.get_for_user(ctx, user_id);
    for (const g of groups) {
        const [accounts, pending] = await Promise.all([
            (0, sharing_resolver_1.resolve_group_accounts)(ctx, g.id),
            (0, sharing_resolver_1.resolve_group_pending_requests)(ctx, g.id),
        ]);
        // 2. DOMAIN (on fresh data) + 3. REPOSITORY
        const applied = await sharing_1.group_repo.apply_mutation(ctx, g.id, [], (group) => (0, group_service_1.leave_group)(group, user_id, now_ms), now_ms);
        if (((_a = applied.validation_errors) === null || _a === void 0 ? void 0 : _a.length) || !applied.entity) {
            result.blocked_group_ids.push(g.id);
            continue;
        }
        const closed = applied.entity.group.deleted_at_ms !== null;
        const leaving = closed ? "all" : [user_id];
        const released = (0, placement_service_1.placements_released)(accounts, g.id, leaving);
        await account_repo_1.account_repo.clear_placements(ctx, released, user_id);
        await (0, versions_1.bump_owner_versions)(accounts.filter((a) => released.includes(a.id)).map((a) => a.user_id));
        await (0, view_reassign_1.reassign_accounts)(ctx, accounts.filter((a) => released.includes(a.id)));
        await (0, view_reassign_1.refresh_group_transfer_roles)(ctx, g.id, [user_id]);
        await sharing_1.request_repo.save_many(ctx, (0, request_service_1.cancel_requests)((0, placement_service_1.requests_released)(pending, leaving), now_ms));
        await (0, budget_view_orchestrator_1.return_moved_in_budgets)(ctx, g.id, leaving, user_id);
        // A closed group's ideas have nobody left to read them (Planning-Module v1).
        if (closed)
            await idea_repo_1.idea_repo.delete_list(ctx, (0, budget_view_service_1.group_view_key)(g.id));
        if (closed)
            result.groups_closed++;
        else
            result.groups_left++;
    }
    const connections = await sharing_1.connection_repo.get_for_user(ctx, user_id);
    for (const c of connections) {
        await sharing_1.connection_repo.delete(ctx, c.id);
        result.connections_removed++;
    }
    await sharing_1.connect_code_repo.delete(ctx, user_id);
    return result;
}
//# sourceMappingURL=departure.orchestrator.js.map