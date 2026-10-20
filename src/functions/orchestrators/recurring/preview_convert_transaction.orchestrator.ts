/**
 * Preview Convert Orchestrator (Convert-To-Recurring Phase 2): what the "Make this a bill" sheet
 * should show for a transaction — READ-ONLY. Reads: the transaction, the user's bills / income, the
 * accounts, the inactive records of the vendor, and the vendor's payments (one doc per payment
 * returned, paged at 600 rows up to 3000; a source without a stored vendorKey adds up to 1500 for
 * the account-window fallback). Typically ~100–200, bounded by the vendor's payment count. A refusal is DATA here (`refusal`), not an error:
 * the sheet explains it. The owner is checked first; flag off → `{enabled: false}` and nothing is
 * read.
 *
 * @module orchestrators/recurring/preview_convert_transaction
 */

import { TraceContext, NotFoundError, PermissionDeniedError } from "../../types";
import { create_span, log_operation_start, log_operation_success, log_operation_error } from "../../observability";
import { is_convert_to_recurring_enabled } from "../../infrastructure/feature_flags";
import { resolve_convert_facts } from "../../resolvers/recurring/convert.resolver";
import { build_preview, ConvertPreview, direction_of } from "../../domain/recurring/convert_plan.service";

export type PreviewResult =
  | { enabled: false }
  | { enabled: true; refusal: { code: string; message: string; details?: Record<string, unknown> } }
  /** `unfinished`: made but never finished (a convert that timed out) — the app taps convert again
   *  to resume it, since only convert finishes it. */
  | { enabled: true; already_converted: { id: string; name: string; unfinished: boolean } }
  | ({ enabled: true } & Omit<ConvertPreview, "ok">);

export async function preview_convert_transaction_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: { transaction_id: string; split_id?: string },
  now_ms: number
): Promise<PreviewResult> {
  const span = create_span(ctx, "orchestrator", "preview_convert_transaction");
  log_operation_start(span, user_id);
  try {
    if (!(await is_convert_to_recurring_enabled(user_id))) return { enabled: false };
    const r = await resolve_convert_facts(ctx, user_id, input.transaction_id, now_ms, input.split_id);
    if (!r.ok) {
      if (r.reason === "not_found") throw new NotFoundError("transaction", input.transaction_id);
      throw new PermissionDeniedError("preview_convert_transaction", input.transaction_id);
    }
    if (r.existing_conversion?.live) {
      return { enabled: true, already_converted: { id: r.existing_conversion.id, name: r.existing_conversion.name, unfinished: !r.existing_conversion.retro_done } };
    }
    // A conversion that was removed: convert refuses it, so the preview says so too.
    if (r.existing_conversion) {
      const message = direction_of(r.facts.txn.type) === "inflow" ? "This was already made into income" : "This was already made into a bill";
      return { enabled: true, refusal: { code: "ALREADY_TRACKED", message, details: { id: r.existing_conversion.id, name: r.existing_conversion.name } } };
    }
    const preview = build_preview(r.facts);
    log_operation_success(span, user_id);
    if (!preview.ok) {
      return { enabled: true, refusal: { code: preview.code, message: preview.message, ...(preview.details ? { details: preview.details } : {}) } };
    }
    const { ok: _ok, ...rest } = preview;
    void _ok;
    return { enabled: true, ...rest };
  } catch (error) {
    log_operation_error(span, error instanceof Error ? error : new Error(String(error)), { user_id });
    throw error;
  }
}
