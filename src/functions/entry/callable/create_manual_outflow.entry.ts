/**
 * Create Manual Outflow Entry Point
 *
 * Creates a recurring bill the user enters by hand (Add Bill). Replaces the
 * app's call to `createRecurringOutflow`, which no longer exists, and the legacy
 * `createManualOutflow`, whose documents the derive path can't read (no root
 * `ownerId`).
 *
 * @module entry/callable/create_manual_outflow
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
  create_manual_outflow_orchestrator,
} from "../../orchestrators/recurring/create_manual_outflow.orchestrator";
import { MANUAL_BILL_FREQUENCIES } from "../../domain/recurring/manual_outflow.service";
import {
  success_response,
  error_response,
  FunctionResponse,
} from "../../types";

/**
 * Input schema. Accepts the app's frequency spelling (`bi_weekly`) too.
 */
const schema = z.object({
  name: z.string().trim().min(1, "Bill name is required").max(120),
  merchant_name: z.string().trim().max(120).optional(),
  amount: z.number().positive("Amount must be greater than zero"),
  frequency: z
    .string()
    .transform((f) => f.toLowerCase().replace(/_/g, ""))
    .pipe(z.enum(MANUAL_BILL_FREQUENCIES)),
  expense_type: z.string().min(1).max(40).default("other"),
  is_essential: z.boolean().default(false),
  due_day: z.number().int().min(1).max(31).optional(),
  debug_mode: z.boolean().optional(),
});

/**
 * Creates a manual recurring bill.
 *
 * @returns The new outflow ID
 */
export const create_manual_outflow = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<{ outflow_id: string }>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "create_manual_outflow");
    log_operation_start(span, user_id);

    const validation = schema.safeParse(request.data || {});
    if (!validation.success) {
      log_operation_error(span, new Error("Validation failed"), {
        user_id,
        error_code: "VALIDATION_ERROR",
      });
      return error_response<{ outflow_id: string }>(
        "VALIDATION_ERROR",
        validation.error.issues.map((i: z.ZodIssue) => i.message).join("; "),
        trace.trace_id
      );
    }
    const data = validation.data;

    try {
      const result = await create_manual_outflow_orchestrator({
        ...trace,
        input: {
          name: data.name,
          merchant_name: data.merchant_name ?? null,
          amount: data.amount,
          frequency: data.frequency,
          expense_type: data.expense_type,
          is_essential: data.is_essential,
          due_day: data.due_day ?? null,
        },
        user_id,
        idempotency_key: `create_manual_outflow:${trace.trace_id}`,
      });

      if (!result.success || !result.outflow_id) {
        return error_response<{ outflow_id: string }>(
          "VALIDATION_ERROR",
          (result.errors ?? ["Invalid bill"]).join("; "),
          trace.trace_id
        );
      }

      log_operation_success(span, user_id);
      return success_response({ outflow_id: result.outflow_id }, trace.trace_id);
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id, error_code: "INTERNAL_ERROR" }
      );
      return error_response<{ outflow_id: string }>(
        "INTERNAL_ERROR",
        "Unable to create the bill. Please try again.",
        trace.trace_id
      );
    }
  }
);
