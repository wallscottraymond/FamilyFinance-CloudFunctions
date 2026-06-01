/**
 * Link Plaid Account Entry Point
 *
 * Cloud Function entry for the complete Plaid Link flow.
 * Called after user completes Plaid Link to:
 * 1. Exchange the public token for access token
 * 2. Save the Plaid item
 * 3. Link accounts
 *
 * @module entry/callable/link_plaid_account
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
import { link_plaid_account_orchestrator } from "../../orchestrators/plaid";
import {
  success_response,
  error_response,
  FunctionResponse,
  LinkPlaidAccountResponse,
} from "../../types";

// Plaid secrets - must be declared at entry point for runtime access
const PLAID_CLIENT_ID = defineSecret("PLAID_CLIENT_ID");
const PLAID_SECRET = defineSecret("PLAID_SECRET");
const TOKEN_ENCRYPTION_KEY = defineSecret("TOKEN_ENCRYPTION_KEY");

/**
 * Input schema for link_plaid_account.
 * Validates request payload using Zod.
 */
const link_plaid_account_input_schema = z.object({
  /** Public token from Plaid Link */
  public_token: z.string().min(1, "Public token is required"),
  /** Institution ID from Plaid Link metadata */
  institution_id: z.string().min(1, "Institution ID is required"),
  /** Institution name from Plaid Link metadata */
  institution_name: z.string().min(1, "Institution name is required"),
  /** Link session ID for idempotency */
  link_session_id: z.string().min(1, "Link session ID is required"),
  /** Debug mode enables verbose logging */
  debug_mode: z.boolean().optional(),
});

/**
 * Type inferred from input schema.
 */
type LinkPlaidAccountInputData = z.infer<typeof link_plaid_account_input_schema>;

/**
 * Link a Plaid account - complete flow.
 *
 * This function:
 * 1. Authenticates the user
 * 2. Validates input
 * 3. Creates trace context
 * 4. Calls the orchestrator (exchange + save item + link accounts)
 * 5. Returns the result
 *
 * @param request.data.public_token - Public token from Plaid Link
 * @param request.data.institution_id - Institution ID from metadata
 * @param request.data.institution_name - Institution name from metadata
 * @param request.data.link_session_id - Link session ID for idempotency
 * @param request.data.debug_mode - Enable verbose logging (optional)
 * @returns Result with item_id and linked account info
 */
export const link_plaid_account = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  {
    maxInstances: 100,
    timeoutSeconds: 60, // Full flow can take time
    secrets: [PLAID_CLIENT_ID, PLAID_SECRET, TOKEN_ENCRYPTION_KEY],
  },
  async (request): Promise<FunctionResponse<LinkPlaidAccountResponse>> => {
    // =========================================================================
    // 1. AUTHENTICATION
    // =========================================================================
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "You must be logged in to link a bank account"
      );
    }

    const user_id = request.auth.uid;

    // =========================================================================
    // 2. CREATE TRACE CONTEXT
    // =========================================================================
    const trace = create_trace_context(request.data?.debug_mode);
    const span = create_span(trace, "entry", "link_plaid_account");
    log_operation_start(span, user_id);

    try {
      // =======================================================================
      // 3. INPUT VALIDATION
      // =======================================================================
      const input_result = link_plaid_account_input_schema.safeParse(request.data || {});

      if (!input_result.success) {
        log_operation_error(span, new Error("Validation failed"), {
          user_id,
          error_code: "VALIDATION_ERROR",
        });

        const error_messages = input_result.error.issues.map(
          (issue: z.ZodIssue) => issue.message
        ).join(", ");

        return error_response<LinkPlaidAccountResponse>(
          "VALIDATION_ERROR",
          error_messages || "Invalid input",
          trace.trace_id
        );
      }

      const input: LinkPlaidAccountInputData = input_result.data;

      // =======================================================================
      // 4. CALL ORCHESTRATOR
      // =======================================================================
      const result = await link_plaid_account_orchestrator({
        ...trace,
        input: {
          public_token: input.public_token,
          institution_id: input.institution_id,
          institution_name: input.institution_name,
          link_session_id: input.link_session_id,
        },
        user_id,
        idempotency_key: `link_plaid_account:${user_id}:${input.link_session_id}`,
      });

      // =======================================================================
      // 5. HANDLE RESULT
      // =======================================================================
      if (!result.success) {
        log_operation_error(span, new Error("Orchestrator failed"), {
          user_id,
          error_code: "LINK_PLAID_ACCOUNT_FAILED",
        });

        return error_response<LinkPlaidAccountResponse>(
          "LINK_PLAID_ACCOUNT_FAILED",
          result.errors?.[0] || "Unable to link bank account",
          trace.trace_id
        );
      }

      log_operation_success(span, user_id);

      return success_response(result.data!, trace.trace_id);
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id, error_code: "INTERNAL_ERROR" }
      );

      // Return generic error message (per project decisions)
      return error_response<LinkPlaidAccountResponse>(
        "INTERNAL_ERROR",
        "Unable to connect to bank. Please try again later.",
        trace.trace_id
      );
    }
  }
);
