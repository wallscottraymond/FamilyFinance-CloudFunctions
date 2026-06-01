/**
 * Remove Account Entry Point
 *
 * Cloud Function entry for soft-deleting an account.
 * Requires idempotency key for safe retries.
 *
 * @module entry/callable/remove_account
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { z } from "zod";
import {
  create_trace_context,
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import {
  remove_account_orchestrator,
  RemoveAccountResult,
} from "../../orchestrators/accounts";
import {
  success_response,
  FunctionResponse,
  DomainError,
  get_https_error_code,
  get_user_message,
} from "../../types";

// Secrets - must be declared at entry point for runtime access
// Required because remove_account calls Plaid's itemRemove which needs:
// 1. Plaid API credentials for authentication
// 2. Decrypted access token for the item being removed
const PLAID_CLIENT_ID = defineSecret("PLAID_CLIENT_ID");
const PLAID_SECRET = defineSecret("PLAID_SECRET");
const TOKEN_ENCRYPTION_KEY = defineSecret("TOKEN_ENCRYPTION_KEY");

/**
 * Input schema for remove_account.
 */
const remove_account_input_schema = z.object({
  /** Account ID to remove */
  account_id: z.string().min(1, "account_id is required"),
  /** Idempotency key for safe retries (UUID recommended) */
  idempotency_key: z.string().min(1, "idempotency_key is required"),
  /**
   * How to handle transaction history:
   * - keep_history: Transactions hidden but still count in budget totals
   * - delete_history: Transactions hidden AND excluded from budget calculations
   */
  removal_mode: z.enum(["keep_history", "delete_history"]).default("keep_history"),
  /** Debug mode enables verbose logging */
  debug_mode: z.boolean().optional(),
});

/**
 * Response data for remove_account.
 * Entry layer DTO - decoupled from orchestrator types.
 */
interface RemoveAccountResponseData {
  /** Whether the account was removed */
  success: boolean;
  /** The removed account ID */
  account_id: string;
  /** Whether this was a duplicate request (already processed) */
  was_idempotent: boolean;
  /** Whether this was a single account or full item removal */
  removal_type: "single_account" | "full_item";
  /** Number of transactions that will be hidden */
  transaction_count: number;
  /** Number of recurring outflows that will be soft-deleted */
  outflow_count: number;
  /** Number of recurring inflows that will be soft-deleted */
  inflow_count: number;
  /** Whether cascade jobs were enqueued for background processing */
  cascade_jobs_enqueued: boolean;
}

/**
 * Remove (soft-delete) an account.
 *
 * This operation is idempotent - calling multiple times with the same
 * idempotency_key will return the same result without re-processing.
 *
 * @param request.data.account_id - Account ID to remove
 * @param request.data.idempotency_key - Key for deduplication
 * @param request.data.debug_mode - Enable verbose logging
 * @returns Remove result
 */
export const remove_account = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  {
    maxInstances: 50,
    secrets: [PLAID_CLIENT_ID, PLAID_SECRET, TOKEN_ENCRYPTION_KEY],
  },
  async (request): Promise<FunctionResponse<RemoveAccountResponseData>> => {
    // 1. Authentication check
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "User must be authenticated"
      );
    }
    const user_id = request.auth.uid;

    // 2. Create trace context (root of trace)
    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "remove_account");
    log_operation_start(span, user_id);

    try {
      // 3. Validate input
      const validation = remove_account_input_schema.safeParse(request.data);
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

      // 4. Get user's group memberships for access check
      // TODO: Fetch from user profile when user_repo is available
      const user_group_ids: string[] = [];

      // 5. Call orchestrator (exactly one)
      const result: RemoveAccountResult = await remove_account_orchestrator(
        ctx,
        user_id,
        {
          account_id: input.account_id,
          idempotency_key: input.idempotency_key,
          removal_mode: input.removal_mode,
        },
        user_group_ids
      );

      // 6. Map response to client DTO
      const response_data: RemoveAccountResponseData = {
        success: result.success,
        account_id: result.account_id,
        was_idempotent: result.was_idempotent,
        removal_type: result.removal_type,
        transaction_count: result.transaction_count,
        outflow_count: result.outflow_count,
        inflow_count: result.inflow_count,
        cascade_jobs_enqueued: result.cascade_jobs_enqueued,
      };

      log_operation_success(span, user_id);

      return success_response(response_data, ctx.trace_id);
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id }
      );

      // Re-throw HttpsError as-is
      if (error instanceof HttpsError) {
        throw error;
      }

      // Convert DomainError to HttpsError
      if (error instanceof DomainError) {
        throw new HttpsError(
          get_https_error_code(error),
          get_user_message(error.code),
          { trace_id: ctx.trace_id, code: error.code }
        );
      }

      // Handle idempotency conflict
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

      // Unknown error
      throw new HttpsError(
        "internal",
        "Failed to remove account",
        { trace_id: ctx.trace_id }
      );
    }
  }
);
