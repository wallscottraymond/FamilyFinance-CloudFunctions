/**
 * Ideas Resolver (Planning-Module v1) — read-only.
 *
 * - An idea touches nothing derived (no budgets, periods or caches): no dependencies.
 * - Reads what the domain needs to decide: the feature flag, the list's group, the idea, and how
 *   many open ideas the list holds.
 *
 * @module resolvers/ideas/idea
 */

import { TraceContext } from "../../types";
import { DependencyResult, no_dependencies } from "../../types/dependency";
import { Group } from "../../types/sharing.types";
import { Idea, IDEAS_FLAG } from "../../types/ideas.types";
import { is_flag_enabled } from "../../infrastructure/feature_flags";
import { group_repo } from "../../repositories/sharing/group.repo";
import { idea_repo } from "../../repositories/idea.repo";
import { group_id_of_key } from "../../domain/sharing/budget_view.service";

/** Ideas are standalone: nothing derived depends on them. */
export function resolve_idea_dependencies(_ctx: TraceContext): DependencyResult {
  return no_dependencies();
}

/** Is Ideas on for this person (`_feature_flags/ideas_v1`)? Never throws; problems = off. */
export async function resolve_ideas_enabled(_ctx: TraceContext, user_id: string): Promise<boolean> {
  if (!user_id) return false;
  return is_flag_enabled(IDEAS_FLAG, { user_id });
}

/** The group behind a "group:<id>" owner key; null for a Me list or a missing group. */
export async function resolve_list_group(
  ctx: TraceContext,
  owner_key: string
): Promise<Group | null> {
  const gid = group_id_of_key(owner_key);
  return gid === null ? null : group_repo.get(ctx, gid);
}

export async function resolve_idea(ctx: TraceContext, idea_id: string): Promise<Idea | null> {
  return idea_repo.get(ctx, idea_id);
}

export async function resolve_open_count(ctx: TraceContext, owner_key: string): Promise<number> {
  return idea_repo.count_open(ctx, owner_key);
}
