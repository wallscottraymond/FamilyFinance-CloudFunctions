/**
 * Create Update Link Token Orchestrator
 *
 * Coordinates update link token creation through all required layers.
 * Used for re-authentication when Plaid connections enter error states.
 *
 * @module orchestrators/plaid/create_update_link_token
 */

import {
  OrchestratorContext,
  CreateUpdateLinkTokenInput,
  CreateUpdateLinkTokenOrchestratorResult,
  CREATE_UPDATE_LINK_TOKEN_BUDGET,
  create_performance_metrics,
  is_budget_exceeded,
} from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
  fire_and_forget,
  log_async_debug,
} from "../../observability";
import { resolve_update_link_token_dependencies } from "../../resolvers/plaid/update_link_token.resolver";
import {
  validate_update_link_token_request,
  should_show_help_message,
} from "../../domain/plaid/update_link_token.service";
import { create_link_token, transform_link_token_response } from "../../integrations/plaid";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

/**
 * Orchestrates update link token creation.
 *
 * Flow:
 * 1. Resolver: Gather dependencies (plaid item, access token, user profile)
 * 2. Domain Service: Validate request (ownership, status, eligibility)
 * 3. Integration Client: Call Plaid API in update mode
 * 4. Transformer: Convert to domain format
 * 5. Repository: Log relink attempt
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Orchestrator result with link token or errors
 */
export async function create_update_link_token_orchestrator(
  ctx: OrchestratorContext<CreateUpdateLinkTokenInput>
): Promise<CreateUpdateLinkTokenOrchestratorResult> {
  const span = create_span(ctx, "orchestrator", "create_update_link_token");
  const perf = create_performance_metrics();
  log_operation_start(span, ctx.user_id);

  try {
    // =========================================================================
    // 1. RESOLVER: Gather dependencies
    // =========================================================================
    const deps = await resolve_update_link_token_dependencies(ctx, {
      user_id: ctx.user_id,
      item_id: ctx.input.item_id,
    });
    perf.reads += 3; // item, user, relink_attempts

    // =========================================================================
    // 2. DOMAIN SERVICE: Validate request
    // =========================================================================
    const validation = validate_update_link_token_request({
      user_id: ctx.user_id,
      item_found: deps.item_found,
      user_owns_item: deps.user_owns_item,
      item_is_active: deps.plaid_item?.is_active ?? false,
      item_status: deps.plaid_item?.status ?? null,
      access_token_valid: deps.access_token !== null,
      recent_relink_attempts: deps.recent_relink_attempts,
    });

    if (!validation.is_valid) {
      log_operation_error(span, new Error("Validation failed"), {
        user_id: ctx.user_id,
        error_code: "VALIDATION_FAILED",
        context: { errors: validation.errors },
      });

      return {
        success: false,
        errors: validation.errors,
        relink_disabled: validation.relink_disabled,
        disabled_reason: validation.disabled_reason || undefined,
      };
    }

    // Check for help message
    const help_info = should_show_help_message(deps.recent_relink_attempts);
    if (help_info.show_help) {
      console.log(
        `[${ctx.trace_id}] User ${ctx.user_id} has ${deps.recent_relink_attempts} ` +
        `recent relink attempts for item ${ctx.input.item_id}`
      );
    }

    // =========================================================================
    // 3. INTEGRATION CLIENT: Call Plaid API in update mode
    // =========================================================================
    const plaid_response = await create_link_token({
      user_id: ctx.user_id,
      user_name: deps.user_display_name,
      user_email: deps.user_email,
      access_token: deps.access_token!, // Validated in domain service
    });

    // =========================================================================
    // 4. TRANSFORMER: Convert to domain format
    // =========================================================================
    const link_token_result = transform_link_token_response(plaid_response);

    // =========================================================================
    // 5. REPOSITORY: Log relink attempt
    // =========================================================================
    await log_relink_attempt(ctx, deps.plaid_item?.error ?? null);
    perf.writes++;

    // Check performance budget
    if (is_budget_exceeded(perf, CREATE_UPDATE_LINK_TOKEN_BUDGET)) {
      console.warn(
        `[${ctx.trace_id}] Performance budget exceeded for create_update_link_token: ` +
        `reads=${perf.reads}, writes=${perf.writes}, time=${perf.time_ms}ms`
      );
    }

    log_operation_success(span, ctx.user_id);

    // Async debug logging
    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "create_update_link_token",
        status: "success",
        output: {
          request_id: link_token_result.request_id,
          item_id: ctx.input.item_id,
          institution_name: deps.plaid_item?.institution_name,
        },
        context: {
          perf_reads: perf.reads,
          perf_writes: perf.writes,
          recent_relink_attempts: deps.recent_relink_attempts,
        },
      })
    );

    return {
      success: true,
      data: {
        link_token: link_token_result.link_token,
        expiration: link_token_result.expiration,
        institution_name: deps.plaid_item?.institution_name || "Your Bank",
        request_id: link_token_result.request_id,
      },
    };
  } catch (error) {
    // Log the full error for debugging
    console.error("[create_update_link_token_orchestrator] Error:", error);

    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: ctx.user_id, error_code: "CREATE_UPDATE_LINK_TOKEN_FAILED" }
    );

    // Return generic error message (per project decisions)
    return {
      success: false,
      errors: ["Unable to prepare reconnection. Please try again later."],
    };
  }
}

/**
 * Logs a relink attempt to Firestore for tracking.
 *
 * @param ctx - Orchestrator context
 * @param error_code - Error code that triggered the relink
 */
async function log_relink_attempt(
  ctx: OrchestratorContext<CreateUpdateLinkTokenInput>,
  error_code: string | null
): Promise<void> {
  try {
    const db = getFirestore();
    const attempt_ref = db.collection("relink_attempts").doc();

    await attempt_ref.set({
      id: attempt_ref.id,
      user_id: ctx.user_id,
      item_id: ctx.input.item_id,
      error_code,
      trace_id: ctx.trace_id,
      success: null, // Will be updated when relink completes
      created_at: Timestamp.now(),
      completed_at: null,
    });
  } catch (error) {
    // Log but don't fail the main operation
    console.error(
      `[${ctx.trace_id}] Failed to log relink attempt:`,
      error
    );
  }
}
