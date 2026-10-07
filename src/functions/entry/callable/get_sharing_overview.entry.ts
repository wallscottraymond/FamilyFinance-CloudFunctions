/**
 * Get Sharing Overview Entry Point (Account-Rooted-Sharing)
 *
 * Everything the Groups screen shows: groups, connected people, requests, limits.
 *
 * @module entry/callable/get_sharing_overview
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
  get_sharing_overview_orchestrator,
} from "../../orchestrators/sharing/connections.orchestrator";
import { SharingOverview } from "../../domain/sharing/sharing_overview.service";
import { success_response, error_response, FunctionResponse } from "../../types";

const schema = z.object({
  debug_mode: z.boolean().optional(),
});

/**
 * Everything the Groups screen shows: groups, connected people, requests, limits.
 */
export const get_sharing_overview = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<SharingOverview>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "get_sharing_overview");
    log_operation_start(span, user_id);

    const validation = schema.safeParse(request.data || {});
    if (!validation.success) {
      log_operation_error(span, new Error("Validation failed"), {
        user_id,
        error_code: "VALIDATION_ERROR",
      });
      return error_response<SharingOverview>(
        "VALIDATION_ERROR",
        validation.error.issues.map((i: z.ZodIssue) => i.message).join("; "),
        trace.trace_id
      );
    }

    try {
      const result = await get_sharing_overview_orchestrator({
        ...trace,
        input: {},
        user_id,
        idempotency_key: `get_sharing_overview:${trace.trace_id}`,
      });

      log_operation_success(span, user_id);
      return success_response(result, trace.trace_id);
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id, error_code: "INTERNAL_ERROR" }
      );
      return error_response<SharingOverview>(
        "INTERNAL_ERROR",
        "Unable to load your groups. Please try again.",
        trace.trace_id
      );
    }
  }
);
