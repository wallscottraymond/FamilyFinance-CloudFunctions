/**
 * Create Update Link Token Entry Point
 *
 * Cloud Function entry for creating Plaid Link tokens in update mode.
 * Used for re-authentication when bank connections enter error states.
 *
 * @module entry/callable/create_update_link_token
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
import { create_update_link_token_orchestrator } from "../../orchestrators/plaid/create_update_link_token.orchestrator";
import {
  success_response,
  error_response,
  FunctionResponse,
} from "../../types";
import { CreateUpdateLinkTokenResponse } from "../../types/plaid/update_link_token.types";

// Plaid secrets - must be declared at entry point for runtime access
const PLAID_CLIENT_ID = defineSecret("PLAID_CLIENT_ID");
const PLAID_SECRET = defineSecret("PLAID_SECRET");

// Token encryption key - required for decrypting access tokens
const TOKEN_ENCRYPTION_KEY = defineSecret("TOKEN_ENCRYPTION_KEY");

/**
 * Input schema for create_update_link_token.
 * Validates request payload using Zod.
 */
const create_update_link_token_input_schema = z.object({
  /** The Plaid item document ID to create update token for */
  item_id: z.string().min(1, "Item ID is required"),
  /** Idempotency key to prevent duplicate requests */
  idempotency_key: z.string().uuid("Idempotency key must be a valid UUID"),
  /** Debug mode enables verbose logging */
  debug_mode: z.boolean().optional(),
});

/**
 * Type inferred from input schema.
 */
type CreateUpdateLinkTokenInputData = z.infer<typeof create_update_link_token_input_schema>;

/**
 * Create a Plaid Link token for re-authentication (update mode).
 *
 * This function:
 * 1. Authenticates the user
 * 2. Validates input
 * 3. Creates trace context
 * 4. Calls the orchestrator
 * 5. Returns the link token for update mode
 *
 * Used when:
 * - User's bank connection enters error state (ITEM_LOGIN_REQUIRED)
 * - OAuth consent is expiring (PENDING_EXPIRATION)
 * - User wants to proactively re-authenticate
 *
 * @param request.data.item_id - The Plaid item document ID
 * @param request.data.idempotency_key - UUID to prevent duplicate requests
 * @param request.data.debug_mode - Enable verbose logging. Optional.
 * @returns Link token response for update mode
 */
export const create_update_link_token = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  {
    maxInstances: 100,
    timeoutSeconds: 30, // Plaid API can be slow
    secrets: [PLAID_CLIENT_ID, PLAID_SECRET, TOKEN_ENCRYPTION_KEY],
  },
  async (request): Promise<FunctionResponse<CreateUpdateLinkTokenResponse>> => {
    // =========================================================================
    // 1. AUTHENTICATION
    // =========================================================================
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "You must be logged in to reconnect a bank account"
      );
    }

    const user_id = request.auth.uid;

    // =========================================================================
    // 2. CREATE TRACE CONTEXT
    // =========================================================================
    const trace = create_trace_context(request.data?.debug_mode);
    const span = create_span(trace, "entry", "create_update_link_token");
    log_operation_start(span, user_id);

    try {
      // =======================================================================
      // 3. INPUT VALIDATION
      // =======================================================================
      const input_result = create_update_link_token_input_schema.safeParse(request.data || {});

      if (!input_result.success) {
        log_operation_error(span, new Error("Validation failed"), {
          user_id,
          error_code: "VALIDATION_ERROR",
        });

        const error_messages = input_result.error.issues.map(
          (issue: z.ZodIssue) => issue.message
        ).join(", ");

        return error_response<CreateUpdateLinkTokenResponse>(
          "VALIDATION_ERROR",
          error_messages || "Invalid input",
          trace.trace_id
        );
      }

      const input: CreateUpdateLinkTokenInputData = input_result.data;

      // =======================================================================
      // 4. CALL ORCHESTRATOR
      // =======================================================================
      const result = await create_update_link_token_orchestrator({
        ...trace,
        input: {
          item_id: input.item_id,
          idempotency_key: input.idempotency_key,
        },
        user_id,
        idempotency_key: input.idempotency_key,
      });

      // =======================================================================
      // 5. HANDLE RESULT
      // =======================================================================
      if (!result.success) {
        log_operation_error(span, new Error("Orchestrator failed"), {
          user_id,
          error_code: result.relink_disabled
            ? "RELINK_DISABLED"
            : "CREATE_UPDATE_LINK_TOKEN_FAILED",
        });

        // Include special handling for disabled relink
        if (result.relink_disabled && result.disabled_reason) {
          return error_response<CreateUpdateLinkTokenResponse>(
            "RELINK_DISABLED",
            result.disabled_reason,
            trace.trace_id
          );
        }

        return error_response<CreateUpdateLinkTokenResponse>(
          "CREATE_UPDATE_LINK_TOKEN_FAILED",
          result.errors?.[0] || "Unable to prepare reconnection",
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
      return error_response<CreateUpdateLinkTokenResponse>(
        "INTERNAL_ERROR",
        "Unable to prepare reconnection. Please try again later.",
        trace.trace_id
      );
    }
  }
);
