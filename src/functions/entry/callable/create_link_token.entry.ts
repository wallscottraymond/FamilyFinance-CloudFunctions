/**
 * Create Link Token Entry Point
 *
 * Cloud Function entry for creating Plaid Link tokens.
 * Enables users to connect bank accounts via Plaid Link.
 *
 * @module entry/callable/create_link_token
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
import { create_link_token_orchestrator } from "../../orchestrators/plaid";
import {
  success_response,
  error_response,
  FunctionResponse,
  CreateLinkTokenResponse,
} from "../../types";

// Plaid secrets - must be declared at entry point for runtime access
const PLAID_CLIENT_ID = defineSecret("PLAID_CLIENT_ID");
const PLAID_SECRET = defineSecret("PLAID_SECRET");

/**
 * Input schema for create_link_token.
 * Validates request payload using Zod.
 */
const create_link_token_input_schema = z.object({
  /** Access token for update mode (re-authentication). Optional. */
  access_token: z.string().optional(),
  /** Redirect URI for OAuth flows. Optional. */
  redirect_uri: z.string().url().optional(),
  /** Debug mode enables verbose logging */
  debug_mode: z.boolean().optional(),
});

/**
 * Type inferred from input schema.
 */
type CreateLinkTokenInputData = z.infer<typeof create_link_token_input_schema>;

/**
 * Create a Plaid Link token for account connection.
 *
 * This function:
 * 1. Authenticates the user
 * 2. Validates input
 * 3. Creates trace context
 * 4. Calls the orchestrator
 * 5. Returns the link token
 *
 * Supports:
 * - Normal mode: Create link token for new account connection
 * - Update mode: Create link token for re-authentication (when credentials expire)
 *
 * @param request.data.access_token - For update mode (re-auth). Optional.
 * @param request.data.redirect_uri - For OAuth flows. Optional.
 * @param request.data.debug_mode - Enable verbose logging. Optional.
 * @returns Link token response
 */
export const create_link_token = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  {
    maxInstances: 100,
    timeoutSeconds: 30, // Plaid API can be slow
    secrets: [PLAID_CLIENT_ID, PLAID_SECRET], // Required for Plaid API access
  },
  async (request): Promise<FunctionResponse<CreateLinkTokenResponse>> => {
    // =========================================================================
    // 1. AUTHENTICATION
    // =========================================================================
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "You must be logged in to create a link token"
      );
    }

    const user_id = request.auth.uid;

    // =========================================================================
    // 2. CREATE TRACE CONTEXT
    // =========================================================================
    const trace = create_trace_context(request.data?.debug_mode);
    const span = create_span(trace, "entry", "create_link_token");
    log_operation_start(span, user_id);

    try {
      // =======================================================================
      // 3. INPUT VALIDATION
      // =======================================================================
      const input_result = create_link_token_input_schema.safeParse(request.data || {});

      if (!input_result.success) {
        log_operation_error(span, new Error("Validation failed"), {
          user_id,
          error_code: "VALIDATION_ERROR",
        });

        const error_messages = input_result.error.issues.map(
          (issue: z.ZodIssue) => issue.message
        ).join(", ");

        return error_response<CreateLinkTokenResponse>(
          "VALIDATION_ERROR",
          error_messages || "Invalid input",
          trace.trace_id
        );
      }

      const input: CreateLinkTokenInputData = input_result.data;

      // =======================================================================
      // 4. CALL ORCHESTRATOR
      // =======================================================================
      const result = await create_link_token_orchestrator({
        ...trace,
        input: {
          access_token: input.access_token,
          redirect_uri: input.redirect_uri,
        },
        user_id,
        idempotency_key: `create_link_token:${user_id}:${Date.now()}`,
      });

      // =======================================================================
      // 5. HANDLE RESULT
      // =======================================================================
      if (!result.success) {
        log_operation_error(span, new Error("Orchestrator failed"), {
          user_id,
          error_code: "CREATE_LINK_TOKEN_FAILED",
        });

        return error_response<CreateLinkTokenResponse>(
          "CREATE_LINK_TOKEN_FAILED",
          result.errors?.[0] || "Unable to create link token",
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
      return error_response<CreateLinkTokenResponse>(
        "INTERNAL_ERROR",
        "Unable to connect to bank. Please try again later.",
        trace.trace_id
      );
    }
  }
);
