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
    account_id?: string | null;
    removal_intervals: RemovalInterval[];
    /** Set when merged into another bill (Convert-To-Recurring) — no Restore from the list. */
    merged_into_id?: string | null;
    /** The stream's last payment date (Plaid `last_date`) — where an "It ended" starts after. */
    last_date?: { toMillis: () => number } | null;
  } | null>;
}

export interface RecurringRemovalContext {
  id: string;
  owner_id: string;
  group_ids: string[];
  /** The account its payments come from (scopes the re-assign); null for a manual item. */
  account_id: string | null;
  removal_intervals: RemovalInterval[];
  merged_into_id: string | null;
  last_payment_ms: number | null;
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
    account_id: item.account_id ?? null,
    removal_intervals: item.removal_intervals,
    merged_into_id: item.merged_into_id ?? null,
    last_payment_ms: item.last_date?.toMillis?.() ?? null,
  };
}
