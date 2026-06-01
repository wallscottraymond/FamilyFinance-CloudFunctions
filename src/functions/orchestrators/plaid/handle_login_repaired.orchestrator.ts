/**
 * Handle Login Repaired Orchestrator
 *
 * Processes ITEM.LOGIN_REPAIRED webhooks.
 * Clears error state, updates status to healthy, and triggers data refresh.
 *
 * @module orchestrators/plaid/handle_login_repaired
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
  compute_login_repaired_update,
  should_trigger_refresh,
} from "../../domain/plaid/item_status_webhook.service";
import { relink_attempt_repo } from "../../repositories/plaid/relink_attempt.repo";
import { sync_balances_orchestrator } from "./sync_balances.orchestrator";

/**
 * Orchestrates handling of ITEM.LOGIN_REPAIRED webhooks.
 *
 * Flow:
 * 1. Resolver: Find item by Plaid item ID
 * 2. Domain Service: Compute status update (clear error)
 * 3. Repository: Update item status
 * 4. Repository: Mark relink attempts as successful
 * 5. (Optional) Trigger data refresh
 *
 * @param ctx - Orchestrator context with webhook input
 * @returns Response indicating success/failure
 */
export async function handle_login_repaired_orchestrator(
  ctx: OrchestratorContext<ItemStatusWebhookInput>
): Promise<ItemStatusWebhookResponse> {
  const span = create_span(ctx, "orchestrator", "handle_login_repaired");
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

    if (!deps.item_found || !deps.item_doc_id || !deps.user_id) {
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
    // 2. DOMAIN SERVICE: Compute status update (clear error)
    // =========================================================================
    const status_update = compute_login_repaired_update();
    const trigger_refresh = should_trigger_refresh(
      deps.current_status,
      status_update.status
    );

    // =========================================================================
    // 3. REPOSITORY: Update item status
    // =========================================================================
    const db = getFirestore();
    const item_ref = db.collection("plaid_items").doc(deps.item_doc_id);

    /* eslint-disable @typescript-eslint/naming-convention */
    await item_ref.update({
      status: status_update.status,
      error: null,
      errorMessage: null,
      errorAt: null,
      requiresReauth: false,
      consentExpiresAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    /* eslint-enable @typescript-eslint/naming-convention */
    perf.writes++;

    // =========================================================================
    // 4. REPOSITORY: Mark relink attempts as successful
    // =========================================================================
    const marked_count = await relink_attempt_repo.mark_all_successful_for_item(
      ctx,
      deps.item_doc_id
    );
    if (marked_count > 0) {
      console.log(
        `[${ctx.trace_id}] Marked ${marked_count} relink attempts as successful`
      );
    }

    // =========================================================================
    // 5. TRIGGER DATA REFRESH (if coming from error state)
    // =========================================================================
    let refresh_triggered = false;

    if (trigger_refresh) {
      console.log(
        `[${ctx.trace_id}] Triggering data refresh after login repair for item ${deps.item_doc_id}`
      );

      // Fire and forget - don't block webhook response
      fire_and_forget(async () => {
        try {
          await sync_balances_orchestrator({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            input: {
              item_id: ctx.input.plaid_item_id,
            },
            user_id: deps.user_id!,
            idempotency_key: `login_repaired_refresh:${deps.item_doc_id}:${Date.now()}`,
          });
          console.log(
            `[${ctx.trace_id}] Data refresh completed for item ${deps.item_doc_id}`
          );
        } catch (error) {
          console.error(
            `[${ctx.trace_id}] Data refresh failed for item ${deps.item_doc_id}:`,
            error
          );
        }
      });

      refresh_triggered = true;
    }

    // Check performance budget
    if (is_budget_exceeded(perf, ITEM_STATUS_WEBHOOK_BUDGET)) {
      console.warn(
        `[${ctx.trace_id}] Performance budget exceeded for handle_login_repaired`
      );
    }

    log_operation_success(span, ctx.user_id);

    // Async debug logging
    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "handle_login_repaired",
        status: "success",
        output: {
          item_doc_id: deps.item_doc_id,
          previous_status: deps.current_status,
          new_status: status_update.status,
          refresh_triggered,
          relink_attempts_marked: marked_count,
        },
        context: {
          institution_name: deps.institution_name,
        },
      })
    );

    return {
      success: true,
      skipped: false,
      item_doc_id: deps.item_doc_id,
      previous_status: deps.current_status || undefined,
      new_status: status_update.status,
      refresh_triggered,
    };
  } catch (error) {
    console.error("[handle_login_repaired_orchestrator] Error:", error);

    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: ctx.user_id, error_code: "HANDLE_LOGIN_REPAIRED_FAILED" }
    );

    return {
      success: false,
      skipped: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
