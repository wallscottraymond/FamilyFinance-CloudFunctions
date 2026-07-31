/**
 * Purge User Data Entry Point
 *
 * Callable that kicks off a FULL, PERMANENT erase of a user. It does NOT delete
 * anything itself (a large user would time out) — it validates, blocks unsafe
 * cases, writes the `purge_status/{uid}` doc, and enqueues the async
 * `purge_user_data` job. The FE listens to the status doc for live progress.
 *
 * Auth: a user may purge their OWN uid; an ADMIN (custom claim) may purge any
 * uid. A fixed confirmation phrase is re-checked server-side (defense in depth).
 *
 * Groups: if the target owns a group with other members, the purge is BLOCKED
 * (status `blocked` + the group list returned) so a shared group is never
 * orphaned — the user must transfer ownership first.
 *
 * @module entry/callable/purge_user_data
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  create_trace_context,
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { create_job } from "../../infrastructure/job_queue";
import {
  set_purge_status,
  PURGE_STATUS_COLLECTION,
} from "../../infrastructure/purge_guard";
import { find_owned_shared_groups } from "../../repositories/purge.repo";
import { success_response, FunctionResponse } from "../../types";

/** The exact phrase the client must send (matched server-side too). */
const CONFIRMATION_PHRASE = "DELETE MY DATA";

const purge_user_data_input_schema = z.object({
  /** Must equal the fixed confirmation phrase. */
  confirmation_phrase: z.string(),
  /** Admin-only: purge a DIFFERENT user. Omit to purge yourself. */
  target_user_id: z.string().min(1).optional(),
  debug_mode: z.boolean().optional(),
});

interface PurgeUserDataResponseData {
  /** True when the purge was refused (e.g. owns a shared group). */
  blocked: boolean;
  /** Reason when blocked. */
  blocked_reason?: string;
  /** Groups blocking the purge (id + name) — for the FE message. */
  blocked_groups?: Array<{ id: string; name: string }>;
  /** The uid being purged. */
  user_id: string;
  /** Path of the live status doc the FE subscribes to. */
  status_doc_path: string;
}

export const purge_user_data = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 10 },
  async (request): Promise<FunctionResponse<PurgeUserDataResponseData>> => {
    // 1. Auth
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const caller_uid = request.auth.uid;
    const is_admin = request.auth.token?.admin === true;

    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "purge_user_data");
    log_operation_start(span, caller_uid);

    try {
      // 2. Validate
      const validation = purge_user_data_input_schema.safeParse(request.data);
      if (!validation.success) {
        throw new HttpsError(
          "invalid-argument",
          validation.error.issues.map((i) => i.message).join("; "),
          { trace_id: ctx.trace_id }
        );
      }
      const input = validation.data;

      // 3. Confirmation phrase (defense in depth — the FE also gates on this).
      if (input.confirmation_phrase !== CONFIRMATION_PHRASE) {
        throw new HttpsError(
          "failed-precondition",
          "Confirmation phrase does not match.",
          { trace_id: ctx.trace_id }
        );
      }

      // 4. Resolve target: self, or (admin-only) another user.
      const target_uid = input.target_user_id ?? caller_uid;
      if (target_uid !== caller_uid && !is_admin) {
        throw new HttpsError(
          "permission-denied",
          "Only an admin can purge another user.",
          { trace_id: ctx.trace_id }
        );
      }

      // 5. Groups pre-check — never orphan a shared group the user owns.
      const shared_groups = await find_owned_shared_groups(target_uid);
      if (shared_groups.length > 0) {
        await set_purge_status(target_uid, {
          state: "blocked",
          initiated_by: caller_uid,
          blocked_reason: "owns_group_with_members",
          blocked_groups: shared_groups,
        });
        log_operation_success(span, caller_uid);
        return success_response(
          {
            blocked: true,
            blocked_reason: "owns_group_with_members",
            blocked_groups: shared_groups,
            user_id: target_uid,
            status_doc_path: `${PURGE_STATUS_COLLECTION}/${target_uid}`,
          },
          ctx.trace_id
        );
      }

      // 6. Mark requested (this doc is ALSO the guard read background writers
      //    honor) + enqueue the async purge job.
      await set_purge_status(target_uid, {
        state: "requested",
        initiated_by: caller_uid,
      });
      await create_job(
        "purge_user_data",
        {
          user_id: target_uid,
          initiated_by: caller_uid,
          trace_id: ctx.trace_id,
        },
        { trace_id: ctx.trace_id }
      );

      log_operation_success(span, caller_uid);
      return success_response(
        {
          blocked: false,
          user_id: target_uid,
          status_doc_path: `${PURGE_STATUS_COLLECTION}/${target_uid}`,
        },
        ctx.trace_id
      );
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id: caller_uid }
      );
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError("internal", "Failed to start purge", {
        trace_id: ctx.trace_id,
      });
    }
  }
);
