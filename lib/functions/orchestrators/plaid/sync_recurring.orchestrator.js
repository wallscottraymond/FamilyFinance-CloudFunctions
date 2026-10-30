"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECURRING_SYNC_BUDGET = void 0;
exports.sync_recurring_orchestrator = sync_recurring_orchestrator;
exports.webhook_recurring_sync_orchestrator = webhook_recurring_sync_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const plaid_1 = require("../../resolvers/plaid");
const plaid_2 = require("../../integrations/plaid");
const plaid_recurring_transformer_1 = require("../../integrations/plaid/plaid_recurring_transformer");
const inflow_service_1 = require("../../domain/inflow.service");
const outflow_service_1 = require("../../domain/outflow.service");
const repositories_1 = require("../../repositories");
const plaid_item_repo_1 = require("../../repositories/plaid/plaid_item.repo");
const classify_internal_transfers_orchestrator_1 = require("./classify_internal_transfers.orchestrator");
const feature_flags_1 = require("../../infrastructure/feature_flags");
const recurring_review_repo_1 = require("../../repositories/recurring_review.repo");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const recurring_capture_resolver_1 = require("../../resolvers/recurring/recurring_capture.resolver");
const recurring_capture_planner_service_1 = require("../../domain/recurring/recurring_capture_planner.service");
const review_item_service_1 = require("../../domain/recurring/review_item.service");
/**
 * Performance budget for recurring sync.
 */
exports.RECURRING_SYNC_BUDGET = {
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
async function sync_recurring_orchestrator(ctx, 
/** From `sync_item`: stamp writes with the run id and leave the transfer check to the run's
 *  single follow-up pass (it needs the transactions in place first). */
opts) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
    const written = [];
    const start_time = Date.now();
    const perf = (0, types_1.create_performance_metrics)();
    const errors = [];
    console.log(`[${ctx.trace_id}] Starting recurring sync for user ${ctx.user_id}, item ${ctx.input.item_id}`);
    // 1. RESOLVE DEPENDENCIES
    const deps = await (0, plaid_1.resolve_recurring_sync_dependencies)((0, observability_1.create_child_span)(ctx), {
        item_id: ctx.input.item_id,
        user_id: ctx.user_id,
    });
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
        plaid_response = await (0, plaid_2.fetch_recurring_transactions)(deps.plaid_item.access_token, ctx.input.account_ids);
    }
    catch (error) {
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
    console.log(`[${ctx.trace_id}] Plaid recurring response: ` +
        `inflows=${(_b = (_a = plaid_response.inflow_streams) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0}, ` +
        `outflows=${(_d = (_c = plaid_response.outflow_streams) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0}`);
    // 3. TRANSFORM TO DOMAIN FORMAT
    const transform_context = {
        user_id: ctx.user_id,
        plaid_item_id: deps.plaid_item.plaid_item_id,
        group_ids: deps.user_context.group_ids,
    };
    const inflow_result = (0, plaid_recurring_transformer_1.transform_inflow_streams)((_e = plaid_response.inflow_streams) !== null && _e !== void 0 ? _e : [], transform_context);
    const outflow_result = (0, plaid_recurring_transformer_1.transform_outflow_streams)((_f = plaid_response.outflow_streams) !== null && _f !== void 0 ? _f : [], transform_context);
    // Log transformation errors
    if ((0, types_1.has_errors)(inflow_result)) {
        errors.push(...((_g = inflow_result.validation_errors) !== null && _g !== void 0 ? _g : []));
    }
    if ((0, types_1.has_errors)(outflow_result)) {
        errors.push(...((_h = outflow_result.validation_errors) !== null && _h !== void 0 ? _h : []));
    }
    // Drop streams on removed (inactive) accounts — otherwise the sync would
    // re-activate the bills/income the account removal soft-deleted.
    const inflows = (0, types_1.get_entities)(inflow_result).filter((i) => deps.active_account_ids.has(i.account_id));
    const outflows = (0, types_1.get_entities)(outflow_result).filter((o) => deps.active_account_ids.has(o.account_id));
    console.log(`[${ctx.trace_id}] Transformed: inflows=${inflows.length}, outflows=${outflows.length}`);
    // 4. DOMAIN VALIDATION
    const validated_inflows_result = (0, inflow_service_1.validate_inflows_for_sync)(inflows);
    const validated_outflows_result = (0, outflow_service_1.validate_outflows_for_sync)(outflows);
    if ((0, types_1.has_errors)(validated_inflows_result)) {
        errors.push(...((_j = validated_inflows_result.validation_errors) !== null && _j !== void 0 ? _j : []));
    }
    if ((0, types_1.has_errors)(validated_outflows_result)) {
        errors.push(...((_k = validated_outflows_result.validation_errors) !== null && _k !== void 0 ? _k : []));
    }
    const valid_inflows = (0, types_1.get_entities)(validated_inflows_result);
    const valid_outflows = (0, types_1.get_entities)(validated_outflows_result);
    // 5. COMPUTE MERGE SUGGESTIONS
    const inflow_merge_result = (0, inflow_service_1.compute_inflow_merge_suggestions)(valid_inflows, deps.existing_manual_inflows);
    const outflow_merge_result = (0, outflow_service_1.compute_outflow_merge_suggestions)(valid_outflows, deps.existing_manual_outflows);
    const inflow_suggestions = (_l = inflow_merge_result.entities) !== null && _l !== void 0 ? _l : [];
    const outflow_suggestions = (_m = outflow_merge_result.entities) !== null && _m !== void 0 ? _m : [];
    const total_merge_suggestions = inflow_suggestions.length + outflow_suggestions.length;
    if (total_merge_suggestions > 0) {
        console.log(`[${ctx.trace_id}] Merge suggestions: inflows=${inflow_suggestions.length}, ` +
            `outflows=${outflow_suggestions.length}`);
    }
    // 6. CAPTURE PLAN (Convert-To-Recurring). Prefetch the stored docs for every valid stream — the
    //    SAME batched read `save_batch` used to make itself (handed to it below), so this adds no
    //    reads. The planner runs only when the user's flag is on or a record involved is stamped v2
    //    (X11); otherwise every stream is saved and stale-marked exactly as before.
    const [prefetched_inflows, prefetched_outflows] = await Promise.all([
        repositories_1.inflow_repo.get_raw_by_ids((0, observability_1.create_child_span)(ctx), valid_inflows.map((i) => i.id)),
        repositories_1.outflow_repo.get_raw_by_ids((0, observability_1.create_child_span)(ctx), valid_outflows.map((o) => o.id)),
    ]);
    const stale_candidates = (0, plaid_1.get_stale_candidates)(deps, valid_inflows.map((i) => i.id), valid_outflows.map((o) => o.id));
    const existing_records = (0, recurring_capture_resolver_1.capture_records_from_raw)(prefetched_outflows, prefetched_inflows);
    const record_by_id = new Map(deps.active_records.map((r) => [r.id, r]));
    const stale_records = [
        ...stale_candidates.stale_outflow_ids.map((id) => record_by_id.get(id)),
        ...stale_candidates.stale_inflow_ids.map((id) => record_by_id.get(id)),
    ].filter((r) => !!r);
    const flag_on = await (0, feature_flags_1.is_convert_to_recurring_enabled)(ctx.user_id);
    // A converted record (v2 + manual + vendor key) absorbs a matching new stream whatever the flag
    // says (D16 / D42), so it also needs the planner. +1 review read per sync, only for those users.
    const planner_needed = flag_on ||
        [...existing_records.values()].some((r) => r.v2) ||
        stale_records.some((r) => r.v2) ||
        deps.active_records.some((r) => r.v2 && r.source === "manual" && !!r.vendor_key) ||
        deps.plaid_item.review_memory === true;
    let plan = {
        save_outflows: valid_outflows,
        save_inflows: valid_inflows,
        stale_outflow_ids: stale_candidates.stale_outflow_ids,
        stale_inflow_ids: stale_candidates.stale_inflow_ids,
        plaid_inactive_outflow_ids: [],
        plaid_inactive_inflow_ids: [],
        review_items: [],
        state_change: {},
    };
    let review_context = {
        state: null,
        items: new Map(),
    };
    if (planner_needed) {
        const streams = build_planner_streams((_o = plaid_response.inflow_streams) !== null && _o !== void 0 ? _o : [], (_p = plaid_response.outflow_streams) !== null && _p !== void 0 ? _p : [], valid_inflows, valid_outflows, deps.active_account_ids, deps.account_types);
        review_context = await (0, recurring_capture_resolver_1.resolve_capture_review_context)((0, observability_1.create_child_span)(ctx), ctx.user_id, (0, recurring_capture_planner_service_1.review_ids_for_sync)(ctx.user_id, streams, [...existing_records.values(), ...stale_records], new Set(deps.active_records.flatMap((r) => { var _a; return ((_a = r.absorbed_streams) !== null && _a !== void 0 ? _a : []).filter((a) => a.state === "absorbed").map((a) => a.stream_id); }))), deps.plaid_item.doc_id);
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
        let current_input = plan_input;
        plan = (0, recurring_capture_planner_service_1.plan_recurring_capture)(current_input);
        if (plan.wants_inactive_records) {
            // X9: only when a new v2 stream found no same-bill candidate among what's loaded — the
            // user's inactive records (stopped bills, other items) + their active accounts, then replan.
            const inactive = await (0, recurring_capture_resolver_1.resolve_inactive_capture_records)((0, observability_1.create_child_span)(ctx), ctx.user_id);
            current_input = Object.assign(Object.assign({}, current_input), { same_bill: {
                    candidates: [...deps.active_records, ...inactive.records],
                    active_account_ids: inactive.active_account_ids,
                    inactive_loaded: true,
                } });
            plan = (0, recurring_capture_planner_service_1.plan_recurring_capture)(current_input);
        }
        if (plan.wants_other_items) {
            // Round 4 defect 2: a track's stream is gone from this item and nothing here fulfils it —
            // the user's other Plaid items (one query, ≈ never) may have a live stream of the vendor.
            const ids = await plaid_item_repo_1.plaid_item_repo.get_active_doc_ids_by_user((0, observability_1.create_child_span)(ctx), ctx.user_id);
            current_input = Object.assign(Object.assign({}, current_input), { other_item_doc_ids: ids.filter((id) => id !== deps.plaid_item.doc_id) });
            plan = (0, recurring_capture_planner_service_1.plan_recurring_capture)(current_input);
        }
    }
    // 7. PERSIST INFLOWS (a failed direction drops what depended on its saves — defect 3)
    const failed_save_directions = new Set();
    let inflows_synced = 0;
    if (plan.save_inflows.length > 0) {
        try {
            const inflow_write_result = await repositories_1.inflow_repo.save_batch((0, observability_1.create_child_span)(ctx), plan.save_inflows, opts === null || opts === void 0 ? void 0 : opts.run_id, prefetched_inflows);
            written.push(...inflow_write_result.written);
            inflows_synced = inflow_write_result.count;
            perf.writes += inflow_write_result.count;
        }
        catch (error) {
            const error_msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[${ctx.trace_id}] Error saving inflows:`, error_msg);
            errors.push(`Inflow save error: ${error_msg}`);
            failed_save_directions.add("inflow");
        }
    }
    // 7b. PERSIST OUTFLOWS
    let outflows_synced = 0;
    if (plan.save_outflows.length > 0) {
        try {
            const outflow_write_result = await repositories_1.outflow_repo.save_batch((0, observability_1.create_child_span)(ctx), plan.save_outflows, opts === null || opts === void 0 ? void 0 : opts.run_id, prefetched_outflows);
            written.push(...outflow_write_result.written);
            outflows_synced = outflow_write_result.count;
            perf.writes += outflow_write_result.count;
        }
        catch (error) {
            const error_msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[${ctx.trace_id}] Error saving outflows:`, error_msg);
            errors.push(`Outflow save error: ${error_msg}`);
            failed_save_directions.add("outflow");
        }
    }
    // 7c. ABSORBS (D42): a converted record takes a new stream that is its own bill — one stamped
    //     write per record, only when something changed; a failure drops what depended on it.
    const newly_absorbed_plaid_ids = new Set();
    const absorbing_records = [];
    for (const a of (_q = plan.absorbs) !== null && _q !== void 0 ? _q : []) {
        try {
            const repo = a.direction === "outflow" ? repositories_1.outflow_repo : repositories_1.inflow_repo;
            await repo.record_absorbed((0, observability_1.create_child_span)(ctx), a.record_id, a.streams, a.txn_ids, (_r = opts === null || opts === void 0 ? void 0 : opts.run_id) !== null && _r !== void 0 ? _r : ctx.trace_id);
            perf.writes++;
            for (const id of a.added_txn_ids)
                newly_absorbed_plaid_ids.add(id);
            absorbing_records.push({ id: a.record_id, direction: a.direction });
        }
        catch (error) {
            const error_msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[${ctx.trace_id}] Error recording absorb on ${a.record_id}:`, error_msg);
            errors.push(`Absorb error: ${error_msg}`);
            failed_save_directions.add(a.direction);
        }
    }
    // 8. STALE DETECTION (old records exactly as before; v2 records are asked about, not dropped)
    let inflows_stale = 0;
    let outflows_stale = 0;
    if (plan.stale_inflow_ids.length > 0) {
        try {
            const stale_results = await repositories_1.inflow_repo.mark_stale((0, observability_1.create_child_span)(ctx), plan.stale_inflow_ids, ctx.user_id);
            inflows_stale = stale_results.length;
            perf.writes += stale_results.length;
            console.log(`[${ctx.trace_id}] Marked ${inflows_stale} inflows as stale`);
        }
        catch (error) {
            const error_msg = error instanceof Error ? error.message : "Unknown error";
            errors.push(`Inflow stale marking error: ${error_msg}`);
        }
    }
    if (plan.stale_outflow_ids.length > 0) {
        try {
            const stale_results = await repositories_1.outflow_repo.mark_stale((0, observability_1.create_child_span)(ctx), plan.stale_outflow_ids, ctx.user_id);
            outflows_stale = stale_results.length;
            perf.writes += stale_results.length;
            console.log(`[${ctx.trace_id}] Marked ${outflows_stale} outflows as stale`);
        }
        catch (error) {
            const error_msg = error instanceof Error ? error.message : "Unknown error";
            errors.push(`Outflow stale marking error: ${error_msg}`);
        }
    }
    // 8b. REVIEW ITEMS + STATE (only when the planner ran; each written only when it changed).
    //     A save that failed takes its effects with it: the ids it would release stay held and the
    //     items it would close stay open, so the next sync does it again (defect 3).
    plan = (0, recurring_capture_planner_service_1.drop_failed_saves)(plan, failed_save_directions);
    let review_items_written = 0;
    let newly_suppressed = [];
    if (planner_needed) {
        try {
            await Promise.all([
                repositories_1.outflow_repo.set_plaid_is_active((0, observability_1.create_child_span)(ctx), plan.plaid_inactive_outflow_ids, false, ctx.user_id, opts === null || opts === void 0 ? void 0 : opts.run_id),
                repositories_1.inflow_repo.set_plaid_is_active((0, observability_1.create_child_span)(ctx), plan.plaid_inactive_inflow_ids, false, ctx.user_id, opts === null || opts === void 0 ? void 0 : opts.run_id),
            ]);
            // Guarded (defect 1): written in a transaction against the fresh items, skipping any the
            // user answered (or anyone changed) since the planner read them, and nothing at all for a
            // user being erased (Top-25 #15) — a plan from an earlier read never reverts an answer.
            review_items_written = (await recurring_review_repo_1.recurring_review_repo.write_items_guarded((0, observability_1.create_child_span)(ctx), ctx.user_id, (0, review_item_service_1.changed_items)(plan.review_items, review_context.items), review_context.items)).written;
            // Checked against the state already read (no extra read when nothing changes); written in a
            // transaction against the FRESH doc so a concurrent answer / detector write isn't lost.
            if ((0, review_item_service_1.apply_review_state_change)(review_context.state, ctx.user_id, plan.state_change).changed) {
                const next_state = await recurring_review_repo_1.recurring_review_repo.apply_state_change((0, observability_1.create_child_span)(ctx), ctx.user_id, plan.state_change);
                if (next_state.changed) {
                    const had = new Set((_t = (_s = next_state.previous) === null || _s === void 0 ? void 0 : _s.suppressed_txn_ids) !== null && _t !== void 0 ? _t : []);
                    newly_suppressed = next_state.next.suppressed_txn_ids.filter((id) => !had.has(id));
                }
                // The held-out set feeds the derive and the engine (X3): invalidate the derive cache.
                if (next_state.suppressed_changed)
                    await (0, derive_version_repo_1.bump_derive_version)(ctx.user_id).catch(() => { });
            }
        }
        catch (error) {
            const error_msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[${ctx.trace_id}] Review item / state write failed:`, error_msg);
            errors.push(`Review state error: ${error_msg}`);
        }
    }
    // 9. UPDATE PLAID ITEM TIMESTAMP (via repository)
    try {
        await plaid_item_repo_1.plaid_item_repo.update_last_recurring_sync_at((0, observability_1.create_child_span)(ctx), deps.plaid_item.doc_id);
        perf.writes++;
    }
    catch (error) {
        const error_msg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[${ctx.trace_id}] Error updating plaid_item timestamp:`, error_msg);
        errors.push(`Timestamp update error: ${error_msg}`);
    }
    // 9.5 CLASSIFY INTERNAL TRANSFERS — durably hide internal account transfers that
    // Plaid recreates on each sync (kept: external ACH bills + credit-card payments).
    // Non-fatal: a classification failure must not fail the sync.
    if (!(opts === null || opts === void 0 ? void 0 : opts.run_id))
        try {
            const classified = await (0, classify_internal_transfers_orchestrator_1.classify_internal_transfers_orchestrator)(ctx, ctx.user_id, Date.now());
            if (classified.hidden_outflows + classified.hidden_inflows > 0) {
                console.log(`[${ctx.trace_id}] Hid internal transfers: ${classified.hidden_outflows} outflow(s), ${classified.hidden_inflows} inflow(s)`);
            }
        }
        catch (error) {
            const error_msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[${ctx.trace_id}] Internal-transfer classification error:`, error_msg);
            errors.push(`Internal-transfer classification error: ${error_msg}`);
        }
    // 10. BUILD RESPONSE
    const updated_perf = (0, types_1.update_elapsed_time)(perf);
    const response = {
        success: errors.length === 0,
        inflows_synced,
        outflows_synced,
        inflows_stale,
        outflows_stale,
        merge_suggestions: total_merge_suggestions,
        errors: errors.length > 0 ? errors : undefined,
    };
    // 11. CHECK BUDGET
    if ((0, types_1.is_budget_exceeded)(updated_perf, exports.RECURRING_SYNC_BUDGET)) {
        console.warn(`[${ctx.trace_id}] Recurring sync exceeded budget: ` +
            `reads=${updated_perf.reads}/${exports.RECURRING_SYNC_BUDGET.max_reads}, ` +
            `writes=${updated_perf.writes}/${exports.RECURRING_SYNC_BUDGET.max_writes}, ` +
            `time=${updated_perf.time_ms}/${exports.RECURRING_SYNC_BUDGET.max_time_ms}`);
    }
    // 12. ASYNC LOGGING
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "sync_recurring_orchestrator");
    (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
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
    }));
    const duration_ms = Date.now() - start_time;
    console.log(`[${ctx.trace_id}] Recurring sync completed in ${duration_ms}ms: ` +
        `inflows=${inflows_synced}, outflows=${outflows_synced}, ` +
        `stale_inflows=${inflows_stale}, stale_outflows=${outflows_stale}, ` +
        `merge_suggestions=${total_merge_suggestions}, errors=${errors.length}`);
    return Object.assign(Object.assign(Object.assign(Object.assign({}, response), { written, newly_suppressed_plaid_ids: newly_suppressed, review_items_written }), (((_u = plan.handoff_item_doc_ids) === null || _u === void 0 ? void 0 : _u.length) ? { handoff_item_doc_ids: plan.handoff_item_doc_ids } : {})), (newly_absorbed_plaid_ids.size ? { newly_absorbed_plaid_ids: [...newly_absorbed_plaid_ids], absorbing_records } : {}));
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
async function webhook_recurring_sync_orchestrator(ctx, input) {
    console.log(`[${ctx.trace_id}] Starting webhook recurring sync for Plaid item ${input.plaid_item_id}`);
    // 1. RESOLVE DEPENDENCIES (by Plaid item ID)
    const deps = await (0, plaid_1.resolve_webhook_recurring_sync_dependencies)((0, observability_1.create_child_span)(ctx), input.plaid_item_id);
    if (!deps) {
        console.error(`[${ctx.trace_id}] Webhook recurring sync: item not found for ${input.plaid_item_id}`);
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
    const orchestrator_ctx = Object.assign(Object.assign({}, ctx), { input: {
            item_id: deps.plaid_item.doc_id,
            is_webhook: true,
        }, user_id: deps.plaid_item.user_id, idempotency_key: `webhook_recurring:${input.plaid_item_id}:${Math.floor(Date.now() / 60000)}` });
    return sync_recurring_orchestrator(orchestrator_ctx);
}
/**
 * The response's identified streams on active accounts, as the planner sees them: raw Plaid status
 * / frequency / is_active (X10 — never the transformed values), the validated entity when it
 * passed (null = rejected), and the account type (income gate, X17). Lookup only.
 */
function build_planner_streams(raw_inflows, raw_outflows, valid_inflows, valid_outflows, active_account_ids, account_types) {
    const valid = new Map([
        ...valid_inflows.map((i) => [i.id, i]),
        ...valid_outflows.map((o) => [o.id, o]),
    ]);
    const out = [];
    const add = (direction, list) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        for (const st of list) {
            if (!st.stream_id || !st.account_id || !active_account_ids.has(st.account_id))
                continue;
            out.push({
                direction,
                stream_id: st.stream_id,
                entity: (_a = valid.get(st.stream_id)) !== null && _a !== void 0 ? _a : null,
                raw_status: String((_b = st.status) !== null && _b !== void 0 ? _b : "UNKNOWN"),
                raw_frequency: String((_c = st.frequency) !== null && _c !== void 0 ? _c : "UNKNOWN"),
                raw_is_active: st.is_active !== false,
                account_id: st.account_id,
                account_type: (_d = account_types.get(st.account_id)) !== null && _d !== void 0 ? _d : null,
                merchant_name: (_e = st.merchant_name) !== null && _e !== void 0 ? _e : null,
                description: (_f = st.description) !== null && _f !== void 0 ? _f : null,
                detailed_category: (_h = (_g = st.personal_finance_category) === null || _g === void 0 ? void 0 : _g.detailed) !== null && _h !== void 0 ? _h : "",
                transaction_ids: (_j = st.transaction_ids) !== null && _j !== void 0 ? _j : [],
                average_amount: Math.abs((_l = (_k = st.average_amount) === null || _k === void 0 ? void 0 : _k.amount) !== null && _l !== void 0 ? _l : 0),
                predicted_next_ms: st.predicted_next_date ? Date.parse(st.predicted_next_date) : null,
                first_date_ms: st.first_date ? Date.parse(st.first_date) : 0,
            });
        }
    };
    add("inflow", raw_inflows);
    add("outflow", raw_outflows);
    return out;
}
//# sourceMappingURL=sync_recurring.orchestrator.js.map