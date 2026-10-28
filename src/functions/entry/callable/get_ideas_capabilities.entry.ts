/**
 * Get Ideas Capabilities Entry Point (Planning-Module v1): tells the app whether Ideas is on for
 * the caller (the app can't read `_feature_flags`). Returns only `{enabled}`.
 *
 * @module entry/callable/get_ideas_capabilities
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  create_trace_context,
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { get_ideas_capabilities_orchestrator } from "../../orchestrators/ideas/idea.orchestrator";
import { success_response, FunctionResponse } from "../../types";

export const get_ideas_capabilities = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<{ enabled: boolean }>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(false);
    const span = create_span(ctx, "entry", "get_ideas_capabilities");
    log_operation_start(span, user_id);
    try {
      const result = await get_ideas_capabilities_orchestrator(ctx, user_id);
      log_operation_success(span, user_id);
      return success_response(result, ctx.trace_id);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log_operation_error(span, err, { user_id });
      throw new HttpsError("internal", "Failed to read capabilities", { trace_id: ctx.trace_id });
    }
  }
);
