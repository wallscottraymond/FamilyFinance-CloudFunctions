/**
 * Recurring Removal Resolver (generic over outflow/inflow)
 *
 * READ-ONLY: load the context needed to remove/pause/restore/delete a recurring
 * item — owner + group access (authorization) + current `removal_intervals`.
 * Repo-agnostic: any repo exposing `get_by_id` returning those fields works, so
 * outflows and inflows share this. Loads with `include_deleted` so an already-
 * removed item is still manageable.
 *
 * @module resolvers/recurring/recurring_removal
 */

import { TraceContext, ReadOptions } from "../../types";
import { RemovalInterval } from "../../domain/recurring/recurring_suppression.service";

/** The minimal read surface a removal-manageable recurring repo must expose. */
export interface RemovalReadableRepo {
  get_by_id(
    ctx: TraceContext,
    id: string,
    options?: ReadOptions
  ): Promise<{
    id: string;
    user_id: string;
    group_ids: string[];
    removal_intervals: RemovalInterval[];
  } | null>;
}

export interface RecurringRemovalContext {
  id: string;
  owner_id: string;
  group_ids: string[];
  removal_intervals: RemovalInterval[];
}

/** Load the removal context for a recurring item, or null if it doesn't exist. */
export async function resolve_recurring_removal_context(
  ctx: TraceContext,
  repo: RemovalReadableRepo,
  id: string
): Promise<RecurringRemovalContext | null> {
  const item = await repo.get_by_id(ctx, id, { include_deleted: true });
  if (!item) {
    return null;
  }
  return {
    id: item.id,
    owner_id: item.user_id,
    group_ids: item.group_ids,
    removal_intervals: item.removal_intervals,
  };
}
