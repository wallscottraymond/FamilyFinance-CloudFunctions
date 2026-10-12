/**
 * Backfill Targets Resolver
 *
 * READ-ONLY: enumerates the users the assignment backfill fans out to (each gets one bounded
 * re-assign run).
 *
 * @module resolvers/transactions/backfill_targets
 */

import { TraceContext } from "../../types";
import { user_repo } from "../../repositories/user.repo";

/**
 * Enumerate all user IDs (doc IDs of the `users` collection).
 *
 * Used by the backfill coordinator to fan out one per-user job each.
 */
export async function resolve_backfill_user_ids(
  ctx: TraceContext
): Promise<string[]> {
  return user_repo.get_all_ids(ctx);
}
