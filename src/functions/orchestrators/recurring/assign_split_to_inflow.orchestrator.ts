/**
 * Assign Split → Income Orchestrator (Convert-To-Recurring Phase 2): pin a deposit's split to one
 * of the caller's incomes, or clear the pin.
 *
 *   flag → resolve facts (read-only) → plan (pure: owner, credit, view) → pin (one Firestore
 *   transaction that re-checks both owners) → bump the derive version AFTER the write.
 *
 * The pin write is unstamped, like the bill pin: `on_transaction_written` re-runs the assignment
 * engine for the transaction and reconciles the touched incomes (1 assign job + reconciles — a
 * user tap, not a fan-out).
 *
 * @module orchestrators/recurring/assign_split_to_inflow
 */

import { TraceContext, ConvertRefusedError, NotFoundError, PermissionDeniedError } from "../../types";
import { create_span, log_operation_start, log_operation_success, log_operation_error } from "../../observability";
import { is_convert_to_recurring_enabled } from "../../infrastructure/feature_flags";
import { is_user_purging } from "../../infrastructure/purge_guard";
import { transaction_repo } from "../../repositories/transaction.repo";
import { bump_derive_version } from "../../repositories/derive_version.repo";
import { resolve_inflow_pin_facts } from "../../resolvers/recurring/inflow_pin.resolver";
import { apply_inflow_pin_to_split, plan_inflow_pin } from "../../domain/recurring/inflow_pin.service";

export interface AssignSplitToInflowInput {
  transaction_id: string;
  split_id: string;
  /** The income to pin to; null clears the pin (back to auto-derivation). */
  inflow_id: string | null;
}

export async function assign_split_to_inflow_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: AssignSplitToInflowInput
): Promise<{ transaction_id: string; split_id: string; inflow_id: string | null }> {
  const span = create_span(ctx, "orchestrator", "assign_split_to_inflow");
  log_operation_start(span, user_id);
  try {
    if (!(await is_convert_to_recurring_enabled(user_id))) {
      throw new ConvertRefusedError("FEATURE_OFF", "Assigning a deposit to an income isn't available on this account yet");
    }
    if (await is_user_purging(user_id)) {
      throw new ConvertRefusedError("PURGING", "This account is being erased");
    }
    // 1. Resolve (read-only).
    const facts = await resolve_inflow_pin_facts(ctx, user_id, input.transaction_id, input.inflow_id);
    if (!facts) throw new NotFoundError("transaction", input.transaction_id);
    // 2. Plan (pure).
    const plan = plan_inflow_pin(user_id, facts, input.split_id, input.inflow_id);
    if (!plan.ok) {
      if (plan.code === "PERMISSION_DENIED") throw new PermissionDeniedError("assign_split_to_inflow", input.transaction_id);
      if (plan.code === "NOT_FOUND") throw new NotFoundError("transaction_split", input.split_id);
      throw new ConvertRefusedError(plan.code, plan.message);
    }
    // 3. Write (the repo re-checks both owners inside its transaction), then bump AFTER the write.
    await transaction_repo.pin_split_to_inflow(
      ctx,
      input.transaction_id,
      input.split_id,
      input.inflow_id,
      user_id,
      (split) => apply_inflow_pin_to_split(split, input.inflow_id)
    );
    await bump_derive_version(user_id).catch(() => {});
    log_operation_success(span, user_id);
    return { transaction_id: input.transaction_id, split_id: input.split_id, inflow_id: input.inflow_id };
  } catch (error) {
    log_operation_error(span, error instanceof Error ? error : new Error(String(error)), { user_id });
    throw error;
  }
}
