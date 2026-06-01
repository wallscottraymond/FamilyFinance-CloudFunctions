/**
 * Restore Account Entry Point
 *
 * Cloud Function entry for restoring a soft-deleted account.
 * Only accounts that were single-account removals can be restored.
 *
 * @module entry/callable/restore_account
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
import {
  restore_account_orchestrator,
  RestoreAccountResult,
} from "../../orchestrators/accounts/restore_account.orchestrator";
import {
  success_response,
  FunctionResponse,
  DomainError,
  get_https_error_code,
  get_user_message,
} from "../../types";

/**
 * Input schema for restore_account.
 */
const restore_account_input_schema = z.object({
  /** Account ID to restore */
  account_id: z.string().min(1, "account_id is required"),
  /** Idempotency key for safe retries */
  idempotency_key: z.string().min(1, "idempotency_key is required"),
  /** Whether to also restore hidden transactions */
  restore_transactions: z.boolean().default(true),
  /** Whether to also restore recurring items */
  restore_recurring: z.boolean().default(true),
  /** Debug mode */
  debug_mode: z.boolean().optional(),
});

/**
 * Response data for restore_account.
 */
interface RestoreAccountResponseData {
  /** Whether the account was restored */
  success: boolean;
  /** The restored account ID */
  account_id: string;
  /** Whether this was a duplicate request */
  was_idempotent: boolean;
  /** Whether restore jobs were enqueued */
  restore_jobs_enqueued: boolean;
}

/**
 * Restore a soft-deleted account.
 *
 * Only accounts that were removed via single-account removal
 * (Plaid item still active) can be restored.
 *
 * @param request.data.account_id - Account ID to restore
 * @param request.data.idempotency_key - Key for deduplication
 * @param request.data.restore_transactions - Whether to un-hide transactions
 * @param request.data.restore_recurring - Whether to restore recurring items
 * @returns Restore result
 */
export const restore_account = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 50 },
  async (request): Promise<FunctionResponse<RestoreAccountResponseData>> => {
    // 1. Authentication check
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "User must be authenticated"
      );
    }
    const user_id = request.auth.uid;

    // 2. Create trace context
    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "restore_account");
    log_operation_start(span, user_id);

    try {
      // 3. Validate input
      const validation = restore_account_input_schema.safeParse(request.data);
      if (!validation.success) {
        const messages = validation.error.issues.map(
          (issue: z.ZodIssue) => issue.message
        );
        throw new HttpsError(
          "invalid-argument",
          messages.join("; "),
          { trace_id: ctx.trace_id }
        );
      }
      const input = validation.data;

      // 4. Get user's group memberships
      const user_group_ids: string[] = [];

      // 5. Call orchestrator
      const result: RestoreAccountResult = await restore_account_orchestrator(
        ctx,
        user_id,
        {
          account_id: input.account_id,
          idempotency_key: input.idempotency_key,
          restore_transactions: input.restore_transactions,
          restore_recurring: input.restore_recurring,
        },
        user_group_ids
      );

      // 6. Map response
      const response_data: RestoreAccountResponseData = {
        success: result.success,
        account_id: result.account_id,
        was_idempotent: result.was_idempotent,
        restore_jobs_enqueued: result.restore_jobs_enqueued,
      };

      log_operation_success(span, user_id);

      return success_response(response_data, ctx.trace_id);
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id }
      );

      if (error instanceof HttpsError) {
        throw error;
      }

      if (error instanceof DomainError) {
        throw new HttpsError(
          get_https_error_code(error),
          get_user_message(error.code),
          { trace_id: ctx.trace_id, code: error.code }
        );
      }

      if (
        error instanceof Error &&
        error.message === "Request already in progress"
      ) {
        throw new HttpsError(
          "aborted",
          "This action is already in progress. Please wait.",
          { trace_id: ctx.trace_id }
        );
      }

      // Handle restore validation errors
      if (
        error instanceof Error &&
        error.message.includes("cannot be restored")
      ) {
        throw new HttpsError(
          "failed-precondition",
          error.message,
          { trace_id: ctx.trace_id }
        );
      }

      throw new HttpsError(
        "internal",
        "Failed to restore account",
        { trace_id: ctx.trace_id }
      );
    }
  }
);
