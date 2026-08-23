/**
 * Assign Split → Bill (Outflow) Entry Point
 *
 * Manually pin a transaction split to a recurring bill (outflow), or clear the pin
 * (`outflow_id: null`). The pin is DURABLE: the split records
 * `outflowAssignmentSource="manual"`, which the Transaction Assignment Engine
 * preserves across Plaid re-syncs (mirrors the manual budget pin). The write sets the
 * queryable `splitOutflowIds` denorm and fires `on_transaction_written`, which enqueues
 * the recurring reconcile — so the bill marks paid (counting a pending payment as
 * paid·pending). This is the manual escape hatch for when auto-matching misses.
 *
 * @module entry/callable/assign_split_to_outflow
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
import { transaction_repo } from "../../repositories/transaction.repo";
import {
  success_response,
  FunctionResponse,
  DomainError,
  get_https_error_code,
  get_user_message,
} from "../../types";

const schema = z.object({
  transaction_id: z.string().min(1, "transaction_id is required"),
  split_id: z.string().min(1, "split_id is required"),
  /** The bill to pin to; null clears a manual pin (reverts to auto-derivation). */
  outflow_id: z.string().min(1).nullable(),
  /** Clear the split's budget assignment when pinning to a bill (default: keep). */
  clear_budget: z.boolean().optional(),
  debug_mode: z.boolean().optional(),
});

export const assign_split_to_outflow = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 50 },
  async (request): Promise<FunctionResponse<unknown>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "assign_split_to_outflow");
    log_operation_start(span, user_id);

    try {
      const validation = schema.safeParse(request.data);
      if (!validation.success) {
        throw new HttpsError(
          "invalid-argument",
          validation.error.issues.map((i: z.ZodIssue) => i.message).join("; "),
          { trace_id: ctx.trace_id }
        );
      }
      const { transaction_id, split_id, outflow_id, clear_budget } = validation.data;

      await transaction_repo.pin_split_to_outflow(
        ctx,
        transaction_id,
        split_id,
        outflow_id,
        user_id,
        clear_budget === true
      );

      log_operation_success(span, user_id);
      return success_response(
        { transaction_id, split_id, outflow_id },
        ctx.trace_id
      );
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id }
      );
      if (error instanceof HttpsError) throw error;
      if (error instanceof DomainError) {
        throw new HttpsError(get_https_error_code(error), get_user_message(error.code), {
          trace_id: ctx.trace_id,
        });
      }
      throw new HttpsError("internal", "Failed to assign split to bill", {
        trace_id: ctx.trace_id,
      });
    }
  }
);
