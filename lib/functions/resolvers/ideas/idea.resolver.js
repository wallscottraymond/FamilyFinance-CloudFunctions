"use strict";
/**
 * Ideas Resolver (Planning-Module v1) — read-only.
 *
 * - An idea touches nothing derived (no budgets, periods or caches): no dependencies.
 * - Reads what the domain needs to decide: the feature flag, the list's group, the idea, and how
 *   many open ideas the list holds.
 *
 * @module resolvers/ideas/idea
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_idea_dependencies = resolve_idea_dependencies;
exports.resolve_ideas_enabled = resolve_ideas_enabled;
exports.resolve_list_group = resolve_list_group;
exports.resolve_idea = resolve_idea;
exports.resolve_open_count = resolve_open_count;
const dependency_1 = require("../../types/dependency");
const ideas_types_1 = require("../../types/ideas.types");
const feature_flags_1 = require("../../infrastructure/feature_flags");
const group_repo_1 = require("../../repositories/sharing/group.repo");
const idea_repo_1 = require("../../repositories/idea.repo");
const budget_view_service_1 = require("../../domain/sharing/budget_view.service");
/** Ideas are standalone: nothing derived depends on them. */
function resolve_idea_dependencies(_ctx) {
    return (0, dependency_1.no_dependencies)();
}
/** Is Ideas on for this person (`_feature_flags/ideas_v1`)? Never throws; problems = off. */
async function resolve_ideas_enabled(_ctx, user_id) {
    if (!user_id)
        return false;
    return (0, feature_flags_1.is_flag_enabled)(ideas_types_1.IDEAS_FLAG, { user_id });
}
/** The group behind a "group:<id>" owner key; null for a Me list or a missing group. */
async function resolve_list_group(ctx, owner_key) {
    const gid = (0, budget_view_service_1.group_id_of_key)(owner_key);
    return gid === null ? null : group_repo_1.group_repo.get(ctx, gid);
}
async function resolve_idea(ctx, idea_id) {
    return idea_repo_1.idea_repo.get(ctx, idea_id);
}
async function resolve_open_count(ctx, owner_key) {
    return idea_repo_1.idea_repo.count_open(ctx, owner_key);
}
//# sourceMappingURL=idea.resolver.js.map