/**
 * Create Manual Outflow Orchestrator
 *
 * Creates a user-entered recurring bill (one Plaid didn't detect). Stored in the
 * same shape as a Plaid bill, so the period page, Home and widgets show it via
 * derive-on-read with no special case.
 *
 * @module orchestrators/recurring/create_manual_outflow
 */

import { randomUUID } from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { OrchestratorContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import {
  resolve_create_manual_outflow_dependencies,
} from "../../resolvers/recurring/manual_outflow.resolver";
import {
  build_manual_outflow,
  ManualBillFrequency,
} from "../../domain/recurring/manual_outflow.service";
import { outflow_repo } from "../../repositories/outflow.repo";

/**
 * Input for creating a bill.
 */
export interface CreateManualOutflowInput {
  name: string;
  merchant_name: string | null;
  amount: number;
  frequency: ManualBillFrequency;
  expense_type: string;
  is_essential: boolean;
  due_day: number | null;
}

/**
 * Result of creating a bill.
 */
export interface CreateManualOutflowResult {
  success: boolean;
  outflow_id?: string;
  errors?: string[];
}

/**
 * Orchestrates manual bill creation.
 *
 * @param ctx - Orchestrator context
 * @returns The new outflow ID, or validation errors
 */
export async function create_manual_outflow_orchestrator(
  ctx: OrchestratorContext<CreateManualOutflowInput>
): Promise<CreateManualOutflowResult> {
  const span = create_span(ctx, "orchestrator", "create_manual_outflow");
  log_operation_start(span, ctx.user_id);

  try {
    // 1. RESOLVER (no dependencies for a new bill)
    await resolve_create_manual_outflow_dependencies(ctx);

    // 2. DOMAIN
    const outflow_id = `manual_${randomUUID()}`;
    const result = build_manual_outflow({
      id: outflow_id,
      user_id: ctx.user_id,
      name: ctx.input.name,
      merchant_name: ctx.input.merchant_name,
      amount: ctx.input.amount,
      frequency: ctx.input.frequency,
      expense_type: ctx.input.expense_type,
      is_essential: ctx.input.is_essential,
      due_day: ctx.input.due_day,
      now_ms: Timestamp.now().toMillis(),
    });

    if (result.validation_errors || !result.entity) {
      return { success: false, errors: result.validation_errors ?? ["Invalid bill"] };
    }

    // 3. REPOSITORY — on_outflow_created generates periods; on_recurring_updated
    // invalidates the derive cache.
    await outflow_repo.save_batch(ctx, [result.entity]);

    log_operation_success(span, ctx.user_id);
    return { success: true, outflow_id };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: ctx.user_id, error_code: "CREATE_MANUAL_OUTFLOW_FAILED" }
    );
    throw error;
  }
}
