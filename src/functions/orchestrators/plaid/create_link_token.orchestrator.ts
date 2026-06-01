/**
 * Create Link Token Orchestrator
 *
 * Coordinates link token creation through all required layers.
 * Includes token caching to reduce Plaid API calls.
 *
 * @module orchestrators/plaid/create_link_token
 */

import {
  OrchestratorContext,
  CreateLinkTokenInput,
  CreateLinkTokenOrchestratorResult,
  CREATE_LINK_TOKEN_BUDGET,
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
import { resolve_link_token_dependencies } from "../../resolvers/plaid";
import { validate_link_token_request, is_update_mode_request } from "../../domain/plaid";
import { create_link_token, transform_link_token_response } from "../../integrations/plaid";
import { link_token_event_repo } from "../../repositories/plaid";

/**
 * Orchestrates link token creation.
 *
 * Flow:
 * 1. Resolver: Gather dependencies (user profile, cache, item count)
 * 2. Domain Service: Validate request
 * 3. Check cache: Return cached token if available
 * 4. Integration Client: Call Plaid API
 * 5. Transformer: Convert to domain format
 * 6. Repository: Log event for audit + cache
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Orchestrator result with link token or errors
 */
export async function create_link_token_orchestrator(
  ctx: OrchestratorContext<CreateLinkTokenInput>
): Promise<CreateLinkTokenOrchestratorResult> {
  const span = create_span(ctx, "orchestrator", "create_link_token");
  const perf = create_performance_metrics();
  log_operation_start(span, ctx.user_id);

  const is_update_mode = is_update_mode_request(ctx.input.access_token);

  try {
    // =========================================================================
    // 1. RESOLVER: Gather dependencies + check cache
    // =========================================================================
    const deps = await resolve_link_token_dependencies(ctx, {
      user_id: ctx.user_id,
      access_token: ctx.input.access_token,
      is_update_mode,
    });
    perf.reads += 3; // user, items, cache

    // =========================================================================
    // 2. DOMAIN SERVICE: Validate request
    // =========================================================================
    const validation = validate_link_token_request({
      user_id: ctx.user_id,
      existing_item_count: deps.existing_item_count,
      is_update_mode,
      access_token_valid: deps.access_token_valid,
    });

    if (validation.validation_errors && validation.validation_errors.length > 0) {
      log_operation_error(span, new Error("Validation failed"), {
        user_id: ctx.user_id,
        error_code: "VALIDATION_FAILED",
        context: { errors: validation.validation_errors },
      });

      return {
        success: false,
        errors: validation.validation_errors,
      };
    }

    // =========================================================================
    // 3. INTEGRATION CLIENT: Call Plaid API
    // NOTE: Link tokens are single-use, so we always create a new one.
    // Caching is disabled because a used token cannot be reused.
    // =========================================================================
    const plaid_response = await create_link_token({
      user_id: ctx.user_id,
      user_name: deps.user_display_name,
      user_email: deps.user_email,
      access_token: ctx.input.access_token,
    });

    // =========================================================================
    // 5. TRANSFORMER: Convert to domain format
    // =========================================================================
    const result = transform_link_token_response(plaid_response);

    // =========================================================================
    // 6. REPOSITORY: Log event for audit + cache
    // =========================================================================
    await link_token_event_repo.log_creation({
      user_id: ctx.user_id,
      request_id: result.request_id,
      is_update_mode,
      trace_id: ctx.trace_id,
      link_token: result.link_token,
      expiration: result.expiration,
    });
    perf.writes++;

    // Check performance budget
    if (is_budget_exceeded(perf, CREATE_LINK_TOKEN_BUDGET)) {
      console.warn(
        `[${ctx.trace_id}] Performance budget exceeded for create_link_token: ` +
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
        function: "create_link_token",
        status: "success",
        output: { request_id: result.request_id, is_update_mode },
        context: { cache_hit: false, perf_reads: perf.reads, perf_writes: perf.writes },
      })
    );

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    // Log the full error for debugging
    console.error("[create_link_token_orchestrator] Error:", error);

    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: ctx.user_id, error_code: "CREATE_LINK_TOKEN_FAILED" }
    );

    // Return generic error message (per project decisions)
    return {
      success: false,
      errors: ["Unable to connect to bank. Please try again later."],
    };
  }
}
