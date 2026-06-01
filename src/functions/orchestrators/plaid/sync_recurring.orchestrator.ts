/**
 * Sync Recurring Orchestrator
 *
 * Coordinates the recurring transaction synchronization flow:
 * 1. Resolver: Get plaid_item with access token and existing recurring items
 * 2. Integration: Fetch recurring transactions from Plaid
 * 3. Transform: Convert Plaid format to domain format
 * 4. Domain: Validate and compute merge suggestions
 * 5. Repository: Persist inflows/outflows, handle stale detection
 * 6. Update plaid_item with last sync timestamp
 *
 * @module orchestrators/plaid/sync_recurring
 */

import {
  OrchestratorContext,
  TraceContext,
  PerformanceBudget,
  create_performance_metrics,
  update_elapsed_time,
  is_budget_exceeded,
  has_errors,
  get_entities,
} from "../../types";
import {
  create_child_span,
  create_span,
  fire_and_forget,
  log_async_debug,
} from "../../observability";
import {
  resolve_recurring_sync_dependencies,
  resolve_webhook_recurring_sync_dependencies,
  get_stale_candidates,
} from "../../resolvers/plaid";
import { fetch_recurring_transactions } from "../../integrations/plaid";
import {
  transform_inflow_streams,
  transform_outflow_streams,
} from "../../integrations/plaid/plaid_recurring_transformer";
import {
  validate_inflows_for_sync,
  compute_inflow_merge_suggestions,
} from "../../domain/inflow.service";
import {
  validate_outflows_for_sync,
  compute_outflow_merge_suggestions,
} from "../../domain/outflow.service";
import { inflow_repo, outflow_repo } from "../../repositories";
import { plaid_item_repo } from "../../repositories/plaid/plaid_item.repo";

// ============================================================================
// Types
// ============================================================================

/**
 * Input for recurring sync orchestrator.
 */
export interface RecurringSyncInput {
  /** Plaid item document ID */
  item_id: string;
  /** Optional: specific account IDs to sync */
  account_ids?: string[];
  /** Whether this is triggered by a webhook */
  is_webhook?: boolean;
}

/**
 * Input for webhook-triggered recurring sync.
 */
export interface WebhookRecurringSyncInput {
  /** Plaid item ID (from webhook, not our doc ID) */
  plaid_item_id: string;
}

/**
 * Response from recurring sync orchestrator.
 */
export interface RecurringSyncResponse {
  /** Whether sync completed successfully */
  success: boolean;
  /** Number of inflows created/updated */
  inflows_synced: number;
  /** Number of outflows created/updated */
  outflows_synced: number;
  /** Number of inflows marked stale */
  inflows_stale: number;
  /** Number of outflows marked stale */
  outflows_stale: number;
  /** Number of merge suggestions created */
  merge_suggestions: number;
  /** Any errors encountered */
  errors?: string[];
  /** Error message if failed */
  error?: string;
}

/**
 * Performance budget for recurring sync.
 */
export const RECURRING_SYNC_BUDGET: PerformanceBudget = {
  max_reads: 50,
  max_writes: 100,
  max_time_ms: 15000, // 15 seconds
};

// ============================================================================
// Main Orchestrator
// ============================================================================

/**
 * Orchestrates the recurring transaction synchronization flow.
 *
 * This orchestrator:
 * 1. Fetches recurring transactions from Plaid
 * 2. Transforms to domain format
 * 3. Validates and detects merge opportunities
 * 4. Persists inflows and outflows
 * 5. Handles stale detection
 * 6. Updates plaid_item timestamp
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Sync results with counts
 */
export async function sync_recurring_orchestrator(
  ctx: OrchestratorContext<RecurringSyncInput>
): Promise<RecurringSyncResponse> {
  const start_time = Date.now();
  const perf = create_performance_metrics();
  const errors: string[] = [];

  console.log(
    `[${ctx.trace_id}] Starting recurring sync for user ${ctx.user_id}, item ${ctx.input.item_id}`
  );

  // 1. RESOLVE DEPENDENCIES
  const deps = await resolve_recurring_sync_dependencies(
    create_child_span(ctx),
    {
      item_id: ctx.input.item_id,
      user_id: ctx.user_id,
    }
  );

  if (!deps) {
    return {
      success: false,
      inflows_synced: 0,
      outflows_synced: 0,
      inflows_stale: 0,
      outflows_stale: 0,
      merge_suggestions: 0,
      error: "Failed to resolve dependencies - item not found or not accessible",
    };
  }
  perf.reads += 5; // Estimated reads for resolver

  // 2. FETCH FROM PLAID
  let plaid_response;
  try {
    plaid_response = await fetch_recurring_transactions(
      deps.plaid_item.access_token,
      ctx.input.account_ids
    );
  } catch (error) {
    const error_msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[${ctx.trace_id}] Plaid API error:`, error_msg);
    return {
      success: false,
      inflows_synced: 0,
      outflows_synced: 0,
      inflows_stale: 0,
      outflows_stale: 0,
      merge_suggestions: 0,
      error: `Plaid API error: ${error_msg}`,
    };
  }

  console.log(
    `[${ctx.trace_id}] Plaid recurring response: ` +
    `inflows=${plaid_response.inflow_streams?.length ?? 0}, ` +
    `outflows=${plaid_response.outflow_streams?.length ?? 0}`
  );

  // 3. TRANSFORM TO DOMAIN FORMAT
  const transform_context = {
    user_id: ctx.user_id,
    plaid_item_id: deps.plaid_item.plaid_item_id,
    group_ids: deps.user_context.group_ids,
  };

  const inflow_result = transform_inflow_streams(
    plaid_response.inflow_streams ?? [],
    transform_context
  );

  const outflow_result = transform_outflow_streams(
    plaid_response.outflow_streams ?? [],
    transform_context
  );

  // Log transformation errors
  if (has_errors(inflow_result)) {
    errors.push(...(inflow_result.validation_errors ?? []));
  }
  if (has_errors(outflow_result)) {
    errors.push(...(outflow_result.validation_errors ?? []));
  }

  const inflows = get_entities(inflow_result);
  const outflows = get_entities(outflow_result);

  console.log(
    `[${ctx.trace_id}] Transformed: inflows=${inflows.length}, outflows=${outflows.length}`
  );

  // 4. DOMAIN VALIDATION
  const validated_inflows_result = validate_inflows_for_sync(inflows);
  const validated_outflows_result = validate_outflows_for_sync(outflows);

  if (has_errors(validated_inflows_result)) {
    errors.push(...(validated_inflows_result.validation_errors ?? []));
  }
  if (has_errors(validated_outflows_result)) {
    errors.push(...(validated_outflows_result.validation_errors ?? []));
  }

  const valid_inflows = get_entities(validated_inflows_result);
  const valid_outflows = get_entities(validated_outflows_result);

  // 5. COMPUTE MERGE SUGGESTIONS
  const inflow_merge_result = compute_inflow_merge_suggestions(
    valid_inflows,
    deps.existing_manual_inflows
  );
  const outflow_merge_result = compute_outflow_merge_suggestions(
    valid_outflows,
    deps.existing_manual_outflows
  );

  const inflow_suggestions = inflow_merge_result.entities ?? [];
  const outflow_suggestions = outflow_merge_result.entities ?? [];
  const total_merge_suggestions = inflow_suggestions.length + outflow_suggestions.length;

  if (total_merge_suggestions > 0) {
    console.log(
      `[${ctx.trace_id}] Merge suggestions: inflows=${inflow_suggestions.length}, ` +
      `outflows=${outflow_suggestions.length}`
    );
  }

  // 6. PERSIST INFLOWS
  let inflows_synced = 0;
  if (valid_inflows.length > 0) {
    try {
      const inflow_write_result = await inflow_repo.save_batch(
        create_child_span(ctx),
        valid_inflows
      );
      inflows_synced = inflow_write_result.count;
      perf.writes += inflow_write_result.count;
    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${ctx.trace_id}] Error saving inflows:`, error_msg);
      errors.push(`Inflow save error: ${error_msg}`);
    }
  }

  // 7. PERSIST OUTFLOWS
  let outflows_synced = 0;
  if (valid_outflows.length > 0) {
    try {
      const outflow_write_result = await outflow_repo.save_batch(
        create_child_span(ctx),
        valid_outflows
      );
      outflows_synced = outflow_write_result.count;
      perf.writes += outflow_write_result.count;
    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${ctx.trace_id}] Error saving outflows:`, error_msg);
      errors.push(`Outflow save error: ${error_msg}`);
    }
  }

  // 8. STALE DETECTION
  const current_inflow_ids = valid_inflows.map((i) => i.id);
  const current_outflow_ids = valid_outflows.map((o) => o.id);

  const stale_candidates = get_stale_candidates(
    deps,
    current_inflow_ids,
    current_outflow_ids
  );

  let inflows_stale = 0;
  let outflows_stale = 0;

  if (stale_candidates.stale_inflow_ids.length > 0) {
    try {
      const stale_results = await inflow_repo.mark_stale(
        create_child_span(ctx),
        stale_candidates.stale_inflow_ids,
        ctx.user_id
      );
      inflows_stale = stale_results.length;
      perf.writes += stale_results.length;
      console.log(`[${ctx.trace_id}] Marked ${inflows_stale} inflows as stale`);
    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      errors.push(`Inflow stale marking error: ${error_msg}`);
    }
  }

  if (stale_candidates.stale_outflow_ids.length > 0) {
    try {
      const stale_results = await outflow_repo.mark_stale(
        create_child_span(ctx),
        stale_candidates.stale_outflow_ids,
        ctx.user_id
      );
      outflows_stale = stale_results.length;
      perf.writes += stale_results.length;
      console.log(`[${ctx.trace_id}] Marked ${outflows_stale} outflows as stale`);
    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      errors.push(`Outflow stale marking error: ${error_msg}`);
    }
  }

  // 9. UPDATE PLAID ITEM TIMESTAMP (via repository)
  try {
    await plaid_item_repo.update_last_recurring_sync_at(
      create_child_span(ctx),
      deps.plaid_item.doc_id
    );
    perf.writes++;
  } catch (error) {
    const error_msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[${ctx.trace_id}] Error updating plaid_item timestamp:`, error_msg);
    errors.push(`Timestamp update error: ${error_msg}`);
  }

  // 10. BUILD RESPONSE
  const updated_perf = update_elapsed_time(perf);
  const response: RecurringSyncResponse = {
    success: errors.length === 0,
    inflows_synced,
    outflows_synced,
    inflows_stale,
    outflows_stale,
    merge_suggestions: total_merge_suggestions,
    errors: errors.length > 0 ? errors : undefined,
  };

  // 11. CHECK BUDGET
  if (is_budget_exceeded(updated_perf, RECURRING_SYNC_BUDGET)) {
    console.warn(
      `[${ctx.trace_id}] Recurring sync exceeded budget: ` +
      `reads=${updated_perf.reads}/${RECURRING_SYNC_BUDGET.max_reads}, ` +
      `writes=${updated_perf.writes}/${RECURRING_SYNC_BUDGET.max_writes}, ` +
      `time=${updated_perf.time_ms}/${RECURRING_SYNC_BUDGET.max_time_ms}`
    );
  }

  // 12. ASYNC LOGGING
  const span = create_span(ctx, "orchestrator", "sync_recurring_orchestrator");
  fire_and_forget(() =>
    log_async_debug({
      trace_id: span.trace_id,
      span_id: span.span_id,
      layer: span.layer,
      function: span.function,
      inputs: { item_id: ctx.input.item_id },
      output: response,
      performance: {
        reads: updated_perf.reads,
        writes: updated_perf.writes,
        time_ms: updated_perf.time_ms,
      },
    })
  );

  const duration_ms = Date.now() - start_time;
  console.log(
    `[${ctx.trace_id}] Recurring sync completed in ${duration_ms}ms: ` +
    `inflows=${inflows_synced}, outflows=${outflows_synced}, ` +
    `stale_inflows=${inflows_stale}, stale_outflows=${outflows_stale}, ` +
    `merge_suggestions=${total_merge_suggestions}, errors=${errors.length}`
  );

  return response;
}

// ============================================================================
// Webhook Variant
// ============================================================================

/**
 * Orchestrates recurring sync triggered by a Plaid webhook.
 *
 * Differs from regular sync:
 * - Looks up item by Plaid item ID (not our doc ID)
 * - No idempotency key from client
 *
 * @param ctx - Trace context (no user context for webhooks)
 * @param input - Webhook input with Plaid item ID
 * @returns Sync results
 */
export async function webhook_recurring_sync_orchestrator(
  ctx: TraceContext,
  input: WebhookRecurringSyncInput
): Promise<RecurringSyncResponse> {
  console.log(
    `[${ctx.trace_id}] Starting webhook recurring sync for Plaid item ${input.plaid_item_id}`
  );

  // 1. RESOLVE DEPENDENCIES (by Plaid item ID)
  const deps = await resolve_webhook_recurring_sync_dependencies(
    create_child_span(ctx),
    input.plaid_item_id
  );

  if (!deps) {
    console.error(
      `[${ctx.trace_id}] Webhook recurring sync: item not found for ${input.plaid_item_id}`
    );
    return {
      success: false,
      inflows_synced: 0,
      outflows_synced: 0,
      inflows_stale: 0,
      outflows_stale: 0,
      merge_suggestions: 0,
      error: "Plaid item not found",
    };
  }

  // 2. DELEGATE TO MAIN ORCHESTRATOR
  const orchestrator_ctx: OrchestratorContext<RecurringSyncInput> = {
    ...ctx,
    input: {
      item_id: deps.plaid_item.doc_id,
      is_webhook: true,
    },
    user_id: deps.plaid_item.user_id,
    idempotency_key: `webhook_recurring:${input.plaid_item_id}:${Math.floor(Date.now() / 60000)}`,
  };

  return sync_recurring_orchestrator(orchestrator_ctx);
}
