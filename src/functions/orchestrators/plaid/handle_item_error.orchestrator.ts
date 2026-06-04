/**
 * Handle Item Error Orchestrator
 *
 * Processes ITEM.ERROR and ITEM.PENDING_EXPIRATION webhooks.
 * Updates item status and error details in Firestore.
 *
 * @module orchestrators/plaid/handle_item_error
 */

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  OrchestratorContext,
  create_performance_metrics,
  is_budget_exceeded,
} from "../../types";
import {
  ItemStatusWebhookInput,
  ItemStatusWebhookResponse,
  ITEM_STATUS_WEBHOOK_BUDGET,
  ItemStatusValues,
} from "../../types/plaid/item_status_webhook.types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
  fire_and_forget,
  log_async_debug,
} from "../../observability";
import { resolve_item_status_webhook_dependencies } from "../../resolvers/plaid/item_status_webhook.resolver";
import {
  compute_pending_expiration_update,
  compute_error_update,
  compute_permission_revoked_update,
} from "../../domain/plaid/item_status_webhook.service";

/**
 * Orchestrates handling of ITEM.ERROR, ITEM.PENDING_EXPIRATION,
 * and ITEM.USER_PERMISSION_REVOKED webhooks.
 *
 * Flow:
 * 1. Resolver: Find item by Plaid item ID
 * 2. Domain Service: Compute status update
 * 3. Repository: Update item status
 *
 * @param ctx - Orchestrator context with webhook input
 * @returns Response indicating success/failure
 */
export async function handle_item_error_orchestrator(
  ctx: OrchestratorContext<ItemStatusWebhookInput>
): Promise<ItemStatusWebhookResponse> {
  const span = create_span(ctx, "orchestrator", "handle_item_error");
  const perf = create_performance_metrics();
  log_operation_start(span, ctx.user_id);

  try {
    // =========================================================================
    // 1. RESOLVER: Find item by Plaid item ID
    // =========================================================================
    const deps = await resolve_item_status_webhook_dependencies(ctx, {
      plaid_item_id: ctx.input.plaid_item_id,
    });
    perf.reads++;

    if (!deps.item_found || !deps.item_doc_id) {
      console.warn(
        `[${ctx.trace_id}] Item not found for Plaid item ID: ${ctx.input.plaid_item_id}`
      );

      return {
        success: false,
        skipped: true,
        skip_reason: "Item not found",
      };
    }

    // =========================================================================
    // 2. DOMAIN SERVICE: Compute status update based on webhook code
    // =========================================================================
    let status_update;

    switch (ctx.input.webhook_code) {
      case "PENDING_EXPIRATION":
        status_update = compute_pending_expiration_update(
          ctx.input.consent_expiration_time
        );
        break;

      case "ERROR":
        status_update = compute_error_update(
          ctx.input.error?.error_code || "UNKNOWN_ERROR",
          ctx.input.error?.error_message
        );
        break;

      case "USER_PERMISSION_REVOKED":
        status_update = compute_permission_revoked_update();
        break;

      default:
        console.warn(
          `[${ctx.trace_id}] Unhandled webhook code: ${ctx.input.webhook_code}`
        );
        return {
          success: false,
          skipped: true,
          skip_reason: `Unhandled webhook code: ${ctx.input.webhook_code}`,
        };
    }

    // =========================================================================
    // 3. REPOSITORY: Update item status
    // =========================================================================
    const db = getFirestore();
    const item_ref = db.collection("plaid_items").doc(deps.item_doc_id);

    /* eslint-disable @typescript-eslint/naming-convention */
    const update_data: Record<string, unknown> = {
      status: status_update.status,
      error: status_update.error_code,
      errorMessage: status_update.error_message,
      errorAt: status_update.error_at,
      requiresReauth: status_update.requires_reauth,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (status_update.consent_expires_at) {
      update_data.consentExpiresAt = status_update.consent_expires_at;
    }

    // Transient errors are retried silently by the scheduled auto-retry job.
    // Anchor `transientSince` (the surface-window clock) the FIRST time the item
    // enters a transient state, and reset retry bookkeeping. Repeated transient
    // webhooks must NOT move the anchor, or the 24h surface window never elapses.
    if (status_update.is_transient) {
      const was_transient =
        deps.current_status === ItemStatusValues.TEMPORARY_ERROR ||
        deps.current_status === ItemStatusValues.RATE_LIMITED;
      if (!was_transient) {
        update_data.transientSince = FieldValue.serverTimestamp();
        update_data.retryCount = 0;
        update_data.lastRetryAt = null;
      }
    } else {
      // Surfaced/cleared states are no longer transient — drop the anchor.
      update_data.transientSince = null;
    }
    /* eslint-enable @typescript-eslint/naming-convention */

    await item_ref.update(update_data);
    perf.writes++;

    // Check performance budget
    if (is_budget_exceeded(perf, ITEM_STATUS_WEBHOOK_BUDGET)) {
      console.warn(
        `[${ctx.trace_id}] Performance budget exceeded for handle_item_error`
      );
    }

    log_operation_success(span, ctx.user_id);

    // Async debug logging
    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "handle_item_error",
        status: "success",
        output: {
          item_doc_id: deps.item_doc_id,
          webhook_code: ctx.input.webhook_code,
          new_status: status_update.status,
        },
        context: {
          institution_name: deps.institution_name,
          previous_status: deps.current_status,
          requires_reauth: status_update.requires_reauth,
        },
      })
    );

    return {
      success: true,
      skipped: false,
      item_doc_id: deps.item_doc_id,
      previous_status: deps.current_status || undefined,
      new_status: status_update.status,
    };
  } catch (error) {
    console.error("[handle_item_error_orchestrator] Error:", error);

    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: ctx.user_id, error_code: "HANDLE_ITEM_ERROR_FAILED" }
    );

    return {
      success: false,
      skipped: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
