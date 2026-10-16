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
import { classify_internal_transfers_orchestrator } from "./classify_internal_transfers.orchestrator";
import type { RecurringWrittenDoc } from "../../repositories/recurring_doc_equality";
import type { TransactionStream } from "plaid";
import type {
  InflowForPersistence,
  OutflowForPersistence,
} from "../../integrations/plaid/plaid_recurring_transformer";
import { is_convert_to_recurring_enabled } from "../../infrastructure/feature_flags";
import { recurring_review_repo } from "../../repositories/recurring_review.repo";
import { bump_derive_version } from "../../repositories/derive_version.repo";
import {
  capture_records_from_raw,
  resolve_capture_review_context,
  resolve_inactive_capture_records,
} from "../../resolvers/recurring/recurring_capture.resolver";
import type { CaptureRecordInfo } from "../../resolvers/plaid/recurring_sync.resolver";
import {
  CapturePlan,
  PlannerStream,
  plan_recurring_capture,
  review_ids_for_sync,
} from "../../domain/recurring/recurring_capture_planner.service";
import {
  RecurringReviewState,
  ReviewItem,
  apply_review_state_change,
  changed_items,
} from "../../domain/recurring/review_item.service";

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
  ctx: OrchestratorContext<RecurringSyncInput>,
  /** From `sync_item`: stamp writes with the run id and leave the transfer check to the run's
   *  single follow-up pass (it needs the transactions in place first). */
  opts?: { run_id?: string }
): Promise<RecurringSyncResponse & {
  written: RecurringWrittenDoc[];
  /** Plaid txn ids newly held out of fuzzy bill matching — the item sync re-assigns them (X3). */
  newly_suppressed_plaid_ids?: string[];
  review_items_written?: number;
}> {
  const written: RecurringWrittenDoc[] = [];
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
      written: [],
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
      written: [],
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

  // Drop streams on removed (inactive) accounts — otherwise the sync would
  // re-activate the bills/income the account removal soft-deleted.
  const inflows = get_entities(inflow_result).filter(
    (i) => deps.active_account_ids.has(i.account_id)
  );
  const outflows = get_entities(outflow_result).filter(
    (o) => deps.active_account_ids.has(o.account_id)
  );

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

  // 6. CAPTURE PLAN (Convert-To-Recurring). Prefetch the stored docs for every valid stream — the
  //    SAME batched read `save_batch` used to make itself (handed to it below), so this adds no
  //    reads. The planner runs only when the user's flag is on or a record involved is stamped v2
  //    (X11); otherwise every stream is saved and stale-marked exactly as before.
  const [prefetched_inflows, prefetched_outflows] = await Promise.all([
    inflow_repo.get_raw_by_ids(create_child_span(ctx), valid_inflows.map((i) => i.id)),
    outflow_repo.get_raw_by_ids(create_child_span(ctx), valid_outflows.map((o) => o.id)),
  ]);
  const stale_candidates = get_stale_candidates(
    deps,
    valid_inflows.map((i) => i.id),
    valid_outflows.map((o) => o.id)
  );
  const existing_records = capture_records_from_raw(prefetched_outflows, prefetched_inflows);
  const record_by_id = new Map(deps.active_records.map((r) => [r.id, r]));
  const stale_records = [
    ...stale_candidates.stale_outflow_ids.map((id) => record_by_id.get(id)),
    ...stale_candidates.stale_inflow_ids.map((id) => record_by_id.get(id)),
  ].filter((r): r is CaptureRecordInfo => !!r);
  const flag_on = await is_convert_to_recurring_enabled(ctx.user_id);
  const planner_needed =
    flag_on ||
    [...existing_records.values()].some((r) => r.v2) ||
    stale_records.some((r) => r.v2);

  let plan: CapturePlan = {
    save_outflows: valid_outflows,
    save_inflows: valid_inflows,
    stale_outflow_ids: stale_candidates.stale_outflow_ids,
    stale_inflow_ids: stale_candidates.stale_inflow_ids,
    plaid_inactive_outflow_ids: [],
    plaid_inactive_inflow_ids: [],
    review_items: [],
    state_change: {},
  };
  let review_context: { state: RecurringReviewState | null; items: Map<string, ReviewItem> } = {
    state: null,
    items: new Map(),
  };
  if (planner_needed) {
    const streams = build_planner_streams(
      plaid_response.inflow_streams ?? [],
      plaid_response.outflow_streams ?? [],
      valid_inflows,
      valid_outflows,
      deps.active_account_ids,
      deps.account_types
    );
    review_context = await resolve_capture_review_context(
      create_child_span(ctx),
      ctx.user_id,
      review_ids_for_sync(ctx.user_id, streams, [...existing_records.values(), ...stale_records])
    );
    const plan_input = {
      user_id: ctx.user_id,
      plaid_item_doc_id: deps.plaid_item.doc_id,
      now_ms: Date.now(),
      flag_on,
      streams,
      existing: existing_records,
      stale_candidates: stale_records,
      review_items: review_context.items,
      state: review_context.state,
      same_bill: {
        candidates: deps.active_records,
        active_account_ids: deps.active_account_ids,
        inactive_loaded: false,
      },
    };
    plan = plan_recurring_capture(plan_input);
    if (plan.wants_inactive_records) {
      // X9: only when a new v2 stream found no same-bill candidate among what's loaded — the
      // user's inactive records (stopped bills, other items) + their active accounts, then replan.
      const inactive = await resolve_inactive_capture_records(create_child_span(ctx), ctx.user_id);
      plan = plan_recurring_capture({
        ...plan_input,
        same_bill: {
          candidates: [...deps.active_records, ...inactive.records],
          active_account_ids: inactive.active_account_ids,
          inactive_loaded: true,
        },
      });
    }
  }

  // 7. PERSIST INFLOWS
  let inflows_synced = 0;
  if (plan.save_inflows.length > 0) {
    try {
      const inflow_write_result = await inflow_repo.save_batch(
        create_child_span(ctx),
        plan.save_inflows,
        opts?.run_id,
        prefetched_inflows
      );
      written.push(...inflow_write_result.written);
      inflows_synced = inflow_write_result.count;
      perf.writes += inflow_write_result.count;
    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${ctx.trace_id}] Error saving inflows:`, error_msg);
      errors.push(`Inflow save error: ${error_msg}`);
    }
  }

  // 7b. PERSIST OUTFLOWS
  let outflows_synced = 0;
  if (plan.save_outflows.length > 0) {
    try {
      const outflow_write_result = await outflow_repo.save_batch(
        create_child_span(ctx),
        plan.save_outflows,
        opts?.run_id,
        prefetched_outflows
      );
      written.push(...outflow_write_result.written);
      outflows_synced = outflow_write_result.count;
      perf.writes += outflow_write_result.count;
    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${ctx.trace_id}] Error saving outflows:`, error_msg);
      errors.push(`Outflow save error: ${error_msg}`);
    }
  }

  // 8. STALE DETECTION (old records exactly as before; v2 records are asked about, not dropped)
  let inflows_stale = 0;
  let outflows_stale = 0;

  if (plan.stale_inflow_ids.length > 0) {
    try {
      const stale_results = await inflow_repo.mark_stale(
        create_child_span(ctx),
        plan.stale_inflow_ids,
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

  if (plan.stale_outflow_ids.length > 0) {
    try {
      const stale_results = await outflow_repo.mark_stale(
        create_child_span(ctx),
        plan.stale_outflow_ids,
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

  // 8b. REVIEW ITEMS + STATE (only when the planner ran; each written only when it changed).
  let review_items_written = 0;
  let newly_suppressed: string[] = [];
  if (planner_needed) {
    try {
      await Promise.all([
        outflow_repo.set_plaid_is_active(create_child_span(ctx), plan.plaid_inactive_outflow_ids, false, ctx.user_id, opts?.run_id),
        inflow_repo.set_plaid_is_active(create_child_span(ctx), plan.plaid_inactive_inflow_ids, false, ctx.user_id, opts?.run_id),
      ]);
      review_items_written = await recurring_review_repo.upsert_items(
        create_child_span(ctx),
        changed_items(plan.review_items, review_context.items)
      );
      const next_state = apply_review_state_change(review_context.state, ctx.user_id, plan.state_change);
      if (next_state.changed) {
        await recurring_review_repo.set_state(create_child_span(ctx), next_state.next);
        const had = new Set(review_context.state?.suppressed_txn_ids ?? []);
        newly_suppressed = next_state.next.suppressed_txn_ids.filter((id) => !had.has(id));
      }
      // The held-out set feeds the derive and the engine (X3): invalidate the derive cache.
      if (next_state.suppressed_changed) await bump_derive_version(ctx.user_id).catch(() => {});
    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${ctx.trace_id}] Review item / state write failed:`, error_msg);
      errors.push(`Review state error: ${error_msg}`);
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

  // 9.5 CLASSIFY INTERNAL TRANSFERS — durably hide internal account transfers that
  // Plaid recreates on each sync (kept: external ACH bills + credit-card payments).
  // Non-fatal: a classification failure must not fail the sync.
  if (!opts?.run_id) try {
    const classified = await classify_internal_transfers_orchestrator(
      ctx,
      ctx.user_id,
      Date.now()
    );
    if (classified.hidden_outflows + classified.hidden_inflows > 0) {
      console.log(
        `[${ctx.trace_id}] Hid internal transfers: ${classified.hidden_outflows} outflow(s), ${classified.hidden_inflows} inflow(s)`
      );
    }
  } catch (error) {
    const error_msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[${ctx.trace_id}] Internal-transfer classification error:`, error_msg);
    errors.push(`Internal-transfer classification error: ${error_msg}`);
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

  return { ...response, written, newly_suppressed_plaid_ids: newly_suppressed, review_items_written };
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

/**
 * The response's identified streams on active accounts, as the planner sees them: raw Plaid status
 * / frequency / is_active (X10 — never the transformed values), the validated entity when it
 * passed (null = rejected), and the account type (income gate, X17). Lookup only.
 */
function build_planner_streams(
  raw_inflows: TransactionStream[],
  raw_outflows: TransactionStream[],
  valid_inflows: InflowForPersistence[],
  valid_outflows: OutflowForPersistence[],
  active_account_ids: Set<string>,
  account_types: Map<string, string>
): PlannerStream[] {
  const valid = new Map<string, InflowForPersistence | OutflowForPersistence>([
    ...valid_inflows.map((i) => [i.id, i] as const),
    ...valid_outflows.map((o) => [o.id, o] as const),
  ]);
  const out: PlannerStream[] = [];
  const add = (direction: "outflow" | "inflow", list: TransactionStream[]) => {
    for (const st of list) {
      if (!st.stream_id || !st.account_id || !active_account_ids.has(st.account_id)) continue;
      out.push({
        direction,
        stream_id: st.stream_id,
        entity: valid.get(st.stream_id) ?? null,
        raw_status: String(st.status ?? "UNKNOWN"),
        raw_frequency: String(st.frequency ?? "UNKNOWN"),
        raw_is_active: st.is_active !== false,
        account_id: st.account_id,
        account_type: account_types.get(st.account_id) ?? null,
        merchant_name: st.merchant_name ?? null,
        description: st.description ?? null,
        detailed_category: st.personal_finance_category?.detailed ?? "",
        transaction_ids: st.transaction_ids ?? [],
        average_amount: Math.abs(st.average_amount?.amount ?? 0),
        predicted_next_ms: st.predicted_next_date ? Date.parse(st.predicted_next_date) : null,
        first_date_ms: st.first_date ? Date.parse(st.first_date) : 0,
      });
    }
  };
  add("inflow", raw_inflows);
  add("outflow", raw_outflows);
  return out;
}
