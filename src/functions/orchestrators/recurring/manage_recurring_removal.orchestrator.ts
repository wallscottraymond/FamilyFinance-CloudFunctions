/**
 * Manage Recurring Removal Orchestrator (generic over outflow/inflow)
 *
 * Coordinates the Remove-Recover-Recurring actions on a recurring item: remove
 * (all / going-forward), pause (until a date), restore (forward-only resume), and
 * permanent delete. Loads current state (resolver), authorizes, applies the pure
 * suppression transition (domain), and persists (repo). Repo-agnostic so outflows
 * and inflows share it. Suppression itself is derived on read elsewhere.
 *
 * @module orchestrators/recurring/manage_recurring_removal
 */

import {
  TraceContext,
  WriteResult,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import {
  resolve_recurring_removal_context,
  RemovalReadableRepo,
} from "../../resolvers/recurring/recurring_removal.resolver";
import {
  apply_remove,
  apply_pause,
  apply_restore,
  current_removal_state,
  RemovalInterval,
  RemovalState,
} from "../../domain/recurring/recurring_suppression.service";

/** The write surface a removal-manageable recurring repo must expose. */
export interface RemovalManageableRepo extends RemovalReadableRepo {
  set_removal_intervals(
    ctx: TraceContext,
    id: string,
    intervals: RemovalInterval[],
    removed_by_user: boolean,
    user_id: string
  ): Promise<WriteResult>;
  /**
   * Reflect the new suppression intervals onto the item's materialized periods by
   * flipping each period's `isActive` (suppressed → false). This is what drops a
   * removed bill/income out of `user_summaries` (which reads only isActive==true) and
   * thus out of the live list + totals; restore flips them back.
   */
  apply_period_suppression(
    ctx: TraceContext,
    id: string,
    intervals: RemovalInterval[],
    user_id: string
  ): Promise<number>;
  hard_delete(ctx: TraceContext, id: string, user_id: string): Promise<WriteResult>;
}

export type ManageRecurringRemovalInput =
  | { id: string; action: "remove"; mode: "all" | "going_forward" }
  | { id: string; action: "pause"; resume_ms: number }
  | { id: string; action: "restore" }
  | { id: string; action: "delete" };

export interface ManageRecurringRemovalResult {
  id: string;
  action: ManageRecurringRemovalInput["action"];
  deleted: boolean;
  /** Resulting state (null for a permanent delete). */
  state: RemovalState | null;
}

/** Start of the current month (UTC) — the `from` boundary for going-forward / pause. */
function month_start_utc(now_ms: number): number {
  const d = new Date(now_ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** `removedByUser` denorm = the item has an open (indefinite) removal interval. */
function has_open_interval(intervals: RemovalInterval[]): boolean {
  return intervals.some((i) => i.to_ms === null);
}

export async function manage_recurring_removal_orchestrator(
  ctx: TraceContext,
  user_id: string,
  user_group_ids: string[],
  input: ManageRecurringRemovalInput,
  now_ms: number,
  repo: RemovalManageableRepo,
  entity_kind: "recurring_outflow" | "recurring_inflow"
): Promise<ManageRecurringRemovalResult> {
  const span = create_span(ctx, "orchestrator", "manage_recurring_removal");
  log_operation_start(span, user_id);

  try {
    // 1. Load current state.
    const context = await resolve_recurring_removal_context(ctx, repo, input.id);
    if (!context) {
      throw new NotFoundError(entity_kind, input.id);
    }

    // 2. Authorize: the owner, or a member of a group the item is shared with.
    // (Group membership arrives empty until RBAC-Migration wires user group
    // lookup — effectively owner-only for now.)
    const is_owner = context.owner_id === user_id;
    const is_member = context.group_ids.some((g) => user_group_ids.includes(g));
    if (!is_owner && !is_member) {
      throw new PermissionDeniedError("manage_recurring", input.id);
    }

    // 3. Permanent delete is a distinct hard-delete path (no interval math).
    if (input.action === "delete") {
      await repo.hard_delete(ctx, input.id, user_id);
      log_operation_success(span, user_id);
      return { id: input.id, action: "delete", deleted: true, state: null };
    }

    // 4. Apply the pure suppression transition.
    const month_start_ms = month_start_utc(now_ms);
    let next: RemovalInterval[];
    if (input.action === "remove") {
      next = apply_remove(context.removal_intervals, input.mode, now_ms, month_start_ms);
    } else if (input.action === "pause") {
      if (input.resume_ms <= now_ms) {
        throw new ValidationError(["resume date must be in the future"]);
      }
      next = apply_pause(context.removal_intervals, input.resume_ms, now_ms, month_start_ms);
    } else {
      next = apply_restore(context.removal_intervals, now_ms);
    }

    // 5. Persist the durable intervals on the definition, THEN reflect them onto the
    // materialized periods (flip isActive) so the change shows in the summaries-backed
    // list + totals — not just the derive path. Covers remove / pause / restore alike.
    await repo.set_removal_intervals(ctx, input.id, next, has_open_interval(next), user_id);
    await repo.apply_period_suppression(ctx, input.id, next, user_id);

    log_operation_success(span, user_id);
    return {
      id: input.id,
      action: input.action,
      deleted: false,
      state: current_removal_state(next, now_ms),
    };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id }
    );
    throw error;
  }
}
