/**
 * Get Widget Token Entry Point ([[iOS-Home-Screen-Widgets]] Phase 2)
 *
 * Signed-in callable: returns the account's read-only widget token (creating it on first
 * use). `rotate: true` revokes the old token and issues a new one ("Reset widget access").
 * The app stores it in the shared keychain for the widget extension's self-fetch.
 *
 * @module entry/callable/get_widget_token
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
  get_widget_token_orchestrator,
} from "../../orchestrators/widgets/get_widget_token.orchestrator";
import { success_response, FunctionResponse } from "../../types";

// The token is stored encrypted (same key as Plaid access tokens).
const TOKEN_ENCRYPTION_KEY = defineSecret("TOKEN_ENCRYPTION_KEY");

const schema = z.object({
  rotate: z.boolean().optional(),
  debug_mode: z.boolean().optional(),
});

export const get_widget_token = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20, secrets: [TOKEN_ENCRYPTION_KEY] },
  async (request): Promise<FunctionResponse<{ token: string }>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "get_widget_token");
    log_operation_start(span, user_id);

    const validation = schema.safeParse(request.data ?? {});
    if (!validation.success) {
      throw new HttpsError("invalid-argument", "Invalid request", { trace_id: ctx.trace_id });
    }

    try {
      const result = await get_widget_token_orchestrator(ctx, user_id, {
        rotate: validation.data.rotate === true,
      });
      log_operation_success(span, user_id);
      return success_response(result, ctx.trace_id);
    } catch (error) {
      log_operation_error(span, error instanceof Error ? error : new Error(String(error)), {
        user_id,
      });
      throw new HttpsError("internal", "Failed to get widget token", { trace_id: ctx.trace_id });
    }
  }
);
