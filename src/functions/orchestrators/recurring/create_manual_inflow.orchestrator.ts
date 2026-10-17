/**
 * Create Manual Inflow Orchestrator (Convert-To-Recurring D43, flag on): Add Income through the
 * shared builder — v2 stamp, `source: "manual"`, the caller's own account verified, a D1 key only
 * from a real transaction, never a retro-link. Created stamped with its periods generated inline
 * and one derive bump (no trigger fan-out). The flag-off path stays in the legacy callable,
 * byte-identical.
 *
 * @module orchestrators/recurring/create_manual_inflow
 */

import { randomUUID } from "crypto";
import { TraceContext, ConvertRefusedError, ValidationError } from "../../types";
import { create_span, log_operation_start, log_operation_success, log_operation_error } from "../../observability";
import { inflow_repo } from "../../repositories/inflow.repo";
import { bump_derive_version } from "../../repositories/derive_version.repo";
import { resolve_manual_source } from "../../resolvers/recurring/manual_source.resolver";
import { build_manual_inflow, ManualInflowRequest } from "../../domain/recurring/manual_inflow.service";
import { utc_day_start } from "../../domain/recurring/convert_recurring.service";
import { generate_periods_inline } from "./generate_periods_inline";

export type CreateManualInflowInput = Omit<ManualInflowRequest, "id" | "user_id" | "account_id" | "vendor_key" | "now_ms"> & {
  account_id?: string | null;
  source_transaction_id?: string | null;
};

export async function create_manual_inflow_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: CreateManualInflowInput
): Promise<{ inflow_id: string }> {
  const span = create_span(ctx, "orchestrator", "create_manual_inflow");
  log_operation_start(span, user_id);
  try {
    const src = await resolve_manual_source(ctx, user_id, input);
    if (!src.ok) {
      throw new ConvertRefusedError(src.reason === "account_not_yours" ? "ACCOUNT_NOT_YOURS" : "SOURCE_NOT_YOURS",
        "That account or transaction isn't yours");
    }
    const id = `manual_${randomUUID()}`;
    const now_ms = Date.now();
    const { account_id: _a, source_transaction_id: _s, ...rest } = input;
    void _a; void _s;
    const built = build_manual_inflow({
      ...rest, id, user_id, account_id: src.account_id, vendor_key: src.account_id ? src.vendor_key : null, now_ms,
    });
    if (built.errors || !built.inflow) throw new ValidationError(built.errors ?? ["Invalid income"]);
    const run_id = `manual_${randomUUID()}`;
    const entity = built.inflow.vendor_key ? { ...built.inflow, converted_at_ms: utc_day_start(now_ms) } : built.inflow;
    const saved = await inflow_repo.save_batch(ctx, [entity], run_id);
    await generate_periods_inline(ctx, user_id, saved.written.filter((w) => w.created));
    await bump_derive_version(user_id).catch(() => {});
    log_operation_success(span, user_id);
    return { inflow_id: id };
  } catch (error) {
    log_operation_error(span, error instanceof Error ? error : new Error(String(error)), { user_id });
    throw error;
  }
}
