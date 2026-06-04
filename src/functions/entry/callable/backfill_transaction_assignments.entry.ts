/**
 * Backfill Transaction Assignments Entry Point
 *
 * Admin/one-shot callable that kicks off the assignment-engine backfill after
 * the hard cutover off the legacy increment spend model. It does NOT do the
 * work inline — it enqueues a single `backfill_assignments` coordinator job and
 * returns immediately; the job self-fans (per user → per transaction + per
 * budget) through the `_jobs` queue. Idempotent: safe to call repeatedly.
 *
 * Wire contract is snake_case (admin/dev-facing, no frontend dependency).
 *
 * Scope & auth:
 *   - default (no args): backfills the CALLER's own data.
 *   - `user_id` (other than caller) or `all_users: true`: requires an `admin`
 *     custom claim.
 *
 * @module entry/callable/backfill_transaction_assignments
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { create_job } from "../../infrastructure/job_queue";
import { generate_id } from "../../observability";

/** Input: scope the backfill. Both optional; default = caller's own data. */
const backfill_input_schema = z.object({
  /** Backfill a specific user (admin only when not the caller). */
  user_id: z.string().min(1).optional(),
  /** Backfill every user (admin only). */
  all_users: z.boolean().optional(),
});

export const backfill_transaction_assignments = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { memory: "256MiB", timeoutSeconds: 120 },
  async (request) => {
    // 1. AUTHENTICATION
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const caller_uid = request.auth.uid;
    const is_admin = request.auth.token?.admin === true;

    // 2. INPUT VALIDATION
    const validation = backfill_input_schema.safeParse(request.data || {});
    if (!validation.success) {
      throw new HttpsError(
        "invalid-argument",
        validation.error.issues.map((e) => e.message).join("; ")
      );
    }
    const { user_id, all_users } = validation.data;

    // 3. AUTHORIZATION: cross-user / all-users requires admin.
    const targets_other_user = !!user_id && user_id !== caller_uid;
    if ((all_users || targets_other_user) && !is_admin) {
      throw new HttpsError(
        "permission-denied",
        "Backfilling another user or all users requires admin privileges."
      );
    }

    // 4. TRACE CONTEXT
    const trace_id = generate_id();

    // 5. ENQUEUE the coordinator job (no inline work).
    //    all_users → payload with no user_id (orchestrator fans out all users);
    //    otherwise → a single user (the target or the caller).
    const payload = all_users ? {} : { user_id: user_id ?? caller_uid };
    const scope = all_users
      ? "all_users"
      : (payload as { user_id: string }).user_id;

    console.log(
      `[${trace_id}] backfill_transaction_assignments: caller=${caller_uid}, scope=${scope}`
    );

    await create_job("backfill_assignments", payload, { trace_id });

    // 6. RESPONSE
    return { success: true, enqueued: true, scope, trace_id };
  }
);
