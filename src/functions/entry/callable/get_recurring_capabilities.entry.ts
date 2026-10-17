/**
 * Get Recurring Capabilities Entry Point (Convert-To-Recurring Phase 2): tells the app whether the
 * convert features are on for the caller (the app can't read `_feature_flags`). Returns only
 * `{enabled}`.
 *
 * @module entry/callable/get_recurring_capabilities
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { create_trace_context, create_span, log_operation_start, log_operation_success, log_operation_error } from "../../observability";
import { get_recurring_capabilities_orchestrator } from "../../orchestrators/recurring/get_recurring_capabilities.orchestrator";
import { success_response, FunctionResponse } from "../../types";

export const get_recurring_capabilities = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<{ enabled: boolean }>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(false);
    const span = create_span(ctx, "entry", "get_recurring_capabilities");
    log_operation_start(span, user_id);
    try {
      const result = await get_recurring_capabilities_orchestrator(ctx, user_id);
      log_operation_success(span, user_id);
      return success_response(result, ctx.trace_id);
    } catch (error) {
      log_operation_error(span, error instanceof Error ? error : new Error(String(error)), { user_id });
      throw new HttpsError("internal", "Failed to read capabilities", { trace_id: ctx.trace_id });
    }
  }
);
