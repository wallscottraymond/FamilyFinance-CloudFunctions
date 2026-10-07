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

import { TraceContext } from "../../types";
import { leave_group } from "../../domain/sharing/group.service";
import {
  placements_released,
  requests_released,
} from "../../domain/sharing/placement.service";
import { cancel_requests } from "../../domain/sharing/request.service";
import {
  resolve_group_accounts,
  resolve_group_pending_requests,
} from "../../resolvers/sharing/sharing.resolver";
import {
  connect_code_repo,
  connection_repo,
  group_repo,
  request_repo,
} from "../../repositories/sharing";
import { account_repo } from "../../repositories/account.repo";

export interface DepartureResult {
  groups_left: number;
  groups_closed: number;
  connections_removed: number;
  /** Groups the user couldn't leave (owner with members) — purge should have blocked. */
  blocked_group_ids: string[];
}

/** Removes a user from all sharing. Idempotent: re-running finds nothing left. */
export async function release_user_from_sharing(
  ctx: TraceContext,
  user_id: string
): Promise<DepartureResult> {
  const now_ms = Date.now();
  const result: DepartureResult = {
    groups_left: 0, groups_closed: 0, connections_removed: 0, blocked_group_ids: [],
  };

  // 1. RESOLVER
  const groups = await group_repo.get_for_user(ctx, user_id);

  for (const g of groups) {
    const [accounts, pending] = await Promise.all([
      resolve_group_accounts(ctx, g.id),
      resolve_group_pending_requests(ctx, g.id),
    ]);

    // 2. DOMAIN (on fresh data) + 3. REPOSITORY
    const applied = await group_repo.apply_mutation(
      ctx, g.id, [], (group) => leave_group(group, user_id, now_ms), now_ms
    );
    if (applied.validation_errors?.length || !applied.entity) {
      result.blocked_group_ids.push(g.id);
      continue;
    }
    const closed = applied.entity.group.deleted_at_ms !== null;
    const leaving: string[] | "all" = closed ? "all" : [user_id];
    await account_repo.clear_placements(ctx, placements_released(accounts, g.id, leaving), user_id);
    await request_repo.save_many(ctx, cancel_requests(requests_released(pending, leaving), now_ms));
    if (closed) result.groups_closed++;
    else result.groups_left++;
  }

  const connections = await connection_repo.get_for_user(ctx, user_id);
  for (const c of connections) {
    await connection_repo.delete(ctx, c.id);
    result.connections_removed++;
  }
  await connect_code_repo.delete(ctx, user_id);

  return result;
}
