/**
 * Backfill Recurring Reconciliation Entry Point
 * (Recurring-Period-Reconciliation Phase 7)
 *
 * Admin/one-shot callable that reconciles existing recurring docs' periods. It
 * does NOT do the work inline — it enqueues a single
 * `backfill_recurring_reconciliation` coordinator job and returns; the job
 * self-fans (per user → per recurring doc → `reconcile_recurring_period`).
 * Idempotent: safe to call repeatedly.
 *
 * Wire contract is snake_case (admin/dev-facing).
 *
 * Scope & auth:
 *   - default (no args): the CALLER's own data.
 *   - `user_id` (other than caller) or `all_users: true`: requires an `admin` claim.
 *
 * @module entry/callable/backfill_recurring_reconciliation
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { create_job } from "../../infrastructure/job_queue";
import { generate_id } from "../../observability";

const backfill_input_schema = z.object({
  user_id: z.string().min(1).optional(),
  all_users: z.boolean().optional(),
  /** Regenerate occurrence data before reconciling (fixes legacy/sparse periods). */
  regenerate: z.boolean().optional(),
});

export const backfill_recurring_reconciliation = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { memory: "256MiB", timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const caller_uid = request.auth.uid;
    const is_admin = request.auth.token?.admin === true;

    const validation = backfill_input_schema.safeParse(request.data || {});
    if (!validation.success) {
      throw new HttpsError(
        "invalid-argument",
        validation.error.issues.map((e) => e.message).join("; ")
      );
    }
    const { user_id, all_users, regenerate } = validation.data;

    const targets_other_user = !!user_id && user_id !== caller_uid;
    if ((all_users || targets_other_user) && !is_admin) {
      throw new HttpsError(
        "permission-denied",
        "Backfilling another user or all users requires admin privileges."
      );
    }

    const trace_id = generate_id();
    const payload = all_users
      ? { regenerate }
      : { user_id: user_id ?? caller_uid, regenerate };
    const scope = all_users ? "all_users" : (payload as { user_id: string }).user_id;

    console.log(
      `[${trace_id}] backfill_recurring_reconciliation: caller=${caller_uid}, scope=${scope}`
    );

    await create_job("backfill_recurring_reconciliation", payload, { trace_id });

    return { success: true, enqueued: true, scope, trace_id };
  }
);
