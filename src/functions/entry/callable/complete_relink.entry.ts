/**
 * Complete Relink Entry Point
 *
 * Called by the app right after Plaid update-mode Link succeeds. Plaid sends no
 * webhook for a repair done in our app, so without this the item would stay
 * flagged (and skipped by the scheduled syncs) until the self-heal pass ran.
 *
 * @module entry/callable/complete_relink
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
  complete_relink_orchestrator,
} from "../../orchestrators/plaid/reauth_recovery.orchestrator";
import {
  success_response,
  error_response,
  FunctionResponse,
} from "../../types";
import { CompleteRelinkResponse } from "../../types/plaid/reauth_recovery.types";

// The probe decrypts the access token and calls Plaid; the refresh syncs data.
const PLAID_CLIENT_ID = defineSecret("PLAID_CLIENT_ID");
const PLAID_SECRET = defineSecret("PLAID_SECRET");
const TOKEN_ENCRYPTION_KEY = defineSecret("TOKEN_ENCRYPTION_KEY");

/**
 * Input schema for complete_relink.
 */
const complete_relink_input_schema = z.object({
  /** The Plaid item document ID that was just re-authenticated */
  item_id: z.string().min(1, "Item ID is required"),
  /** Debug mode enables verbose logging */
  debug_mode: z.boolean().optional(),
});

/**
 * Confirms a reconnection, marks the item healthy, and refreshes its data.
 *
 * @param request.data.item_id - The Plaid item document ID
 * @returns Whether the item is repaired and its status
 */
export const complete_relink = onCall(
  /* eslint-disable @typescript-eslint/naming-convention */
  {
    maxInstances: 20,
    timeoutSeconds: 120, // probe + balances + transactions + recurring
    secrets: [PLAID_CLIENT_ID, PLAID_SECRET, TOKEN_ENCRYPTION_KEY],
  },
  /* eslint-enable @typescript-eslint/naming-convention */
  async (request): Promise<FunctionResponse<CompleteRelinkResponse>> => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "You must be logged in to reconnect a bank account"
      );
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode);
    const span = create_span(trace, "entry", "complete_relink");
    log_operation_start(span, user_id);

    const input_result = complete_relink_input_schema.safeParse(request.data || {});
    if (!input_result.success) {
      log_operation_error(span, new Error("Validation failed"), {
        user_id,
        error_code: "VALIDATION_ERROR",
      });
      return error_response<CompleteRelinkResponse>(
        "VALIDATION_ERROR",
        input_result.error.issues.map((issue: z.ZodIssue) => issue.message).join(", "),
        trace.trace_id
      );
    }

    const result = await complete_relink_orchestrator({
      ...trace,
      input: { item_id: input_result.data.item_id },
      user_id,
      idempotency_key: `complete_relink:${input_result.data.item_id}:${trace.trace_id}`,
    });

    if (!result.success || !result.data) {
      log_operation_error(span, new Error("Orchestrator failed"), {
        user_id,
        error_code: result.error_code || "COMPLETE_RELINK_FAILED",
      });
      return error_response<CompleteRelinkResponse>(
        result.error_code || "COMPLETE_RELINK_FAILED",
        result.error || "Unable to confirm the reconnection",
        trace.trace_id
      );
    }

    log_operation_success(span, user_id);
    return success_response(result.data, trace.trace_id);
  }
);
