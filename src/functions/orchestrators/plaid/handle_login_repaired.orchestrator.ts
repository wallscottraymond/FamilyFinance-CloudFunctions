/**
 * Handle Login Repaired Orchestrator
 *
 * Processes ITEM.LOGIN_REPAIRED webhooks.
 * Clears error state, updates status to healthy, and triggers data refresh.
 *
 * @module orchestrators/plaid/handle_login_repaired
 */

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
import { mark_item_repaired, refresh_repaired_item } from "./reauth_recovery.orchestrator";

/**
 * Orchestrates handling of ITEM.LOGIN_REPAIRED webhooks.
 *
 * Flow:
 * 1. Resolver: Find item by Plaid item ID
 * 2. Domain Service: Compute status update (clear error)
 * 3. Repository: Clear error state + mark relink attempts successful
 * 4. (Optional) Trigger a full data refresh
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
    // 3. REPOSITORY: Clear error state + close open relink attempts
    // =========================================================================
    const target = {
      item_doc_id: deps.item_doc_id,
      plaid_item_id: ctx.input.plaid_item_id,
      user_id: deps.user_id,
    };
    await mark_item_repaired(ctx, target);
    perf.writes++;

    // =========================================================================
    // 4. TRIGGER DATA REFRESH (if coming from error state)
    // =========================================================================
    // Full refresh — balances, transactions and recurring — since syncs skipped
    // this item while it was broken. Fire and forget so the webhook answers fast;
    // the scheduled syncs are the backstop if this is cut short.
    let refresh_triggered = false;

    if (trigger_refresh) {
      console.log(
        `[${ctx.trace_id}] Triggering data refresh after login repair for item ${deps.item_doc_id}`
      );
      fire_and_forget(async () => {
        await refresh_repaired_item(ctx, target);
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
