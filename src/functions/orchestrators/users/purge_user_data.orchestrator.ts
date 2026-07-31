/**
 * Purge User Data Orchestrator
 *
 * The job handler for a full, permanent user erase. Runs async (enqueued as a
 * `purge_user_data` job) so a large user (1000s of txns) can't time out a
 * callable. Order:
 *
 *   guard (status → running)
 *   → cancel the user's pending jobs
 *   → re-check owned shared groups (defensive) — block if any
 *   → collect parent ids (budgets/inflows/outflows/plaid_items)
 *   → revoke Plaid access tokens (/item/remove) BEFORE deleting plaid_items
 *   → hard-delete child collections (by parent id)
 *   → hard-delete top-level user-keyed collections
 *   → delete sole-owned groups
 *   → delete users/{uid} doc
 *   → delete the Firebase Auth user
 *   → status → done
 *
 * Idempotent: every delete is "remove what matches", so a retry after a partial
 * failure simply finds less to do. The `purge_status/{uid}` doc doubles as the
 * guard read (`is_user_purging`) that Plaid sync/webhook paths honor.
 *
 * @module orchestrators/users/purge_user_data
 */

import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { plaid_item_repo } from "../../repositories/plaid/plaid_item.repo";
import { decryptAccessToken } from "../../../utils/encryption";
import { remove_item } from "../../integrations/plaid";
import {
  hard_delete_by_field,
  hard_delete_by_parent_ids,
  cancel_pending_jobs,
  find_owned_shared_groups,
  delete_owned_solo_groups,
  hard_delete_doc,
  make_bulk_writer,
} from "../../repositories/purge.repo";
import { set_purge_status } from "../../infrastructure/purge_guard";

/** Job payload for the purge. */
export interface PurgeUserDataInput {
  /** The user being erased. */
  user_id: string;
  /** Who initiated (self uid or an admin uid) — for the status doc. */
  initiated_by: string;
  /** This purge job's id, so cancelling the user's pending jobs skips itself. */
  job_id?: string;
  /** Trace id from the enqueuing entry. */
  trace_id: string;
}

export interface PurgeUserDataResult {
  success: boolean;
  blocked: boolean;
  counts: Record<string, number>;
  auth_delete_pending: boolean;
}

export async function purge_user_data_orchestrator(
  ctx: TraceContext,
  input: PurgeUserDataInput
): Promise<PurgeUserDataResult> {
  const span = create_span(ctx, "orchestrator", "purge_user_data");
  const { user_id } = input;
  log_operation_start(span, user_id);

  const counts: Record<string, number> = {};
  let current_step = "Starting…";
  let total_deleted = 0;
  let last_progress_ms = 0;

  const shaped = (): Record<string, { deleted: number }> =>
    Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, { deleted: v }]));

  const write_progress = async (): Promise<void> => {
    await set_purge_status(user_id, { current_step, total_deleted, counts: shaped() });
  };

  // Fires after each 500-doc batch. Bumps the running total + pushes a THROTTLED
  // status write (~every 800ms) so the FE tracker advances DURING a big sweep
  // (e.g. thousands of outflow_periods) instead of sitting frozen between steps.
  const on_batch = async (n: number): Promise<void> => {
    total_deleted += n;
    const now = Date.now();
    if (now - last_progress_ms > 800) {
      last_progress_ms = now;
      await write_progress();
    }
  };

  // Set the human-readable phase label + flush a status write immediately.
  const step = async (label: string): Promise<void> => {
    current_step = label;
    last_progress_ms = Date.now();
    await write_progress();
  };

  // Record a collection's final count (also flushes so the breakdown updates).
  const record = async (collection: string, n: number): Promise<void> => {
    counts[collection] = (counts[collection] ?? 0) + n;
    await write_progress();
  };

  try {
    await set_purge_status(user_id, {
      state: "running",
      initiated_by: input.initiated_by,
      started_at: Timestamp.now(),
    });

    // 1. Stop anything else from writing this user's data.
    await step("Stopping background tasks…");
    const cancelled = await cancel_pending_jobs(user_id, input.job_id);
    if (cancelled > 0) {
      counts["_jobs_cancelled"] = cancelled;
    }

    // 2. Defensive re-check: never orphan a shared group the user owns.
    const shared = await find_owned_shared_groups(user_id);
    if (shared.length > 0) {
      await set_purge_status(user_id, {
        state: "blocked",
        blocked_reason: "owns_group_with_members",
        blocked_groups: shared,
        finished_at: Timestamp.now(),
      });
      log_operation_success(span, user_id);
      return { success: false, blocked: true, counts, auth_delete_pending: false };
    }

    // 3. One shared BulkWriter parallelizes every delete in this run (much faster
    //    than sequential batch commits). The `*_periods` collections all carry a
    //    `userId`, so they're deleted directly by userId (one predicate) instead
    //    of iterating each parent id — the old per-parent loop was the bottleneck.
    const writer = make_bulk_writer();
    const plaid_items = await plaid_item_repo.get_by_user_id(ctx, user_id, true);

    // 4. Revoke Plaid tokens FIRST. `/item/remove` is REQUIRED to end Plaid
    //    subscription billing + permanently invalidate the token, and is
    //    IRREVERSIBLE — so we must not delete a plaid_item (its token) unless the
    //    revoke succeeded, or we'd orphan a still-billing connection we can no
    //    longer revoke. `remove_item` already treats already-removed
    //    (ITEM_NOT_FOUND / INVALID_ACCESS_TOKEN) as success. An item with no
    //    token can't be revoked (and can't orphan) → treat as deletable.
    //    Genuinely-failed (transient) revokes keep their token and force a retry.
    await step("Disconnecting your banks (Plaid)…");
    const deletable_item_ids = new Set<string>();
    const failed_item_ids: string[] = [];
    for (const item of plaid_items) {
      if (!item.access_token) {
        deletable_item_ids.add(item.id);
        continue;
      }
      try {
        await remove_item(decryptAccessToken(item.access_token));
        deletable_item_ids.add(item.id);
      } catch (err) {
        failed_item_ids.push(item.id);
        console.warn(
          `[${ctx.trace_id}] purge: remove_item failed for item ${item.id}: ${
            (err as Error).message
          }`
        );
      }
    }
    counts["_plaid_items_revoked"] = deletable_item_ids.size;
    const revoked_item_ids = [...deletable_item_ids];

    // 5. Period collections — deleted DIRECTLY by userId (they all carry it), so
    //    one predicate per collection instead of a per-parent loop. These are
    //    usually the largest sweeps and stream per-page progress.
    await step("Deleting budget history…");
    await record("budget_periods", await hard_delete_by_field("budget_periods", "userId", user_id, writer, on_batch));
    await step("Deleting income history…");
    await record("inflow_periods", await hard_delete_by_field("inflow_periods", "userId", user_id, writer, on_batch));
    await step("Deleting bill history…");
    await record("outflow_periods", await hard_delete_by_field("outflow_periods", "userId", user_id, writer, on_batch));
    // Plaid connection records — by parent id, gated to the SUCCESSFULLY-revoked
    // items only (a failed item is kept whole for the retry so its token survives).
    await step("Cleaning up bank connection records…");
    for (const child of ["plaid_webhooks", "relink_attempts", "link_token_events"]) {
      await record(
        child,
        await hard_delete_by_parent_ids(child, "plaidItemId", revoked_item_ids, writer, on_batch)
      );
    }

    // 6. Top-level user-keyed collections. Union of ownerId/userId where both
    //    are used, so nothing is missed regardless of which field a doc set.
    await step("Deleting transactions…");
    await record("transactions", await hard_delete_by_field("transactions", "userId", user_id, writer, on_batch));
    await step("Deleting accounts…");
    await record("accounts", await hard_delete_by_field("accounts", "userId", user_id, writer, on_batch));
    await step("Deleting recurring income…");
    await record(
      "inflows",
      (await hard_delete_by_field("inflows", "ownerId", user_id, writer, on_batch)) +
        (await hard_delete_by_field("inflows", "userId", user_id, writer, on_batch))
    );
    await step("Deleting recurring bills…");
    await record(
      "outflows",
      (await hard_delete_by_field("outflows", "ownerId", user_id, writer, on_batch)) +
        (await hard_delete_by_field("outflows", "userId", user_id, writer, on_batch))
    );
    await step("Deleting budgets…");
    await record(
      "budgets",
      (await hard_delete_by_field("budgets", "ownerId", user_id, writer, on_batch)) +
        (await hard_delete_by_field("budgets", "userId", user_id, writer, on_batch))
    );
    // plaid_items: delete ONLY the successfully-revoked ones (by doc id), so a
    // transient revoke failure keeps its token for the retry.
    await step("Removing bank connections…");
    let plaid_items_deleted = 0;
    for (const id of revoked_item_ids) {
      await hard_delete_doc("plaid_items", id);
      plaid_items_deleted++;
      total_deleted++;
    }
    await record("plaid_items", plaid_items_deleted);
    await step("Deleting summaries…");
    await record("user_summaries", await hard_delete_by_field("user_summaries", "userId", user_id, writer, on_batch));

    // Finalize all enqueued BulkWriter deletes before removing the profile/login,
    // so the data is actually gone (not just enqueued) when we finish.
    await step("Finalizing…");
    await writer.close();

    // 7. Sole-owned groups (shared-owned ones were blocked above).
    const groups_deleted = await delete_owned_solo_groups(user_id);
    total_deleted += groups_deleted;
    await record("groups", groups_deleted);

    // 7b. If any Plaid revoke genuinely failed, STOP before deleting the profile
    //     + auth user: throw so the job retries (idempotent) rather than orphaning
    //     a still-billing Plaid Item we can no longer revoke. The remaining
    //     plaid_item(s) keep their token; other data stays deleted. On retry only
    //     the failed items remain to revoke.
    if (failed_item_ids.length > 0) {
      throw new Error(
        `Plaid /item/remove failed for ${failed_item_ids.length} item(s) ` +
          `(${failed_item_ids.join(", ")}); retrying to avoid orphaning billed connections`
      );
    }

    // 8. Signal DONE **first** — this is the logout trigger the FE listens for.
    //    It must be delivered while the client is still authenticated + can read
    //    the status doc. If we deleted the Auth user before this, the client's
    //    session (and its purge_status listener) would be torn down and it would
    //    NEVER receive `done` → the sign-out would never fire. (That was the bug.)
    counts["users"] = 1; // the profile doc is about to be removed (step 10)
    total_deleted++;
    await set_purge_status(user_id, {
      state: "done",
      current_step: "Signing you out…",
      total_deleted,
      finished_at: Timestamp.now(),
      counts: shaped(),
    });

    // 9. Give the client a moment to receive `done` and start its sign-out, THEN
    //    remove the user from Firebase — revoke any lingering session + delete the
    //    Auth user (the final "user out of Firebase"). A failure here leaves the
    //    data already gone → surface `auth_delete_pending`.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    let auth_delete_pending = false;
    try {
      await getAuth().revokeRefreshTokens(user_id);
      await getAuth().deleteUser(user_id);
    } catch (err) {
      auth_delete_pending = true;
      console.warn(
        `[${ctx.trace_id}] purge: auth deleteUser failed for ${user_id}: ${
          (err as Error).message
        }`
      );
    }

    // 10. Remove the profile doc LAST (after logout + auth removal).
    await hard_delete_doc("users", user_id);

    // Final touch: flag if the Firebase Auth removal couldn't complete.
    if (auth_delete_pending) {
      await set_purge_status(user_id, { auth_delete_pending: true });
    }

    log_operation_success(span, user_id);
    return { success: true, blocked: false, counts, auth_delete_pending };
  } catch (err) {
    log_operation_error(span, err as Error, { user_id });
    await set_purge_status(user_id, {
      state: "failed",
      error_message: (err as Error).message,
      finished_at: Timestamp.now(),
    });
    // Re-throw so the job queue records the failure + retries (idempotent).
    throw err;
  }
}
