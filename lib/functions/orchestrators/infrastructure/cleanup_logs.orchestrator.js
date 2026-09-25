"use strict";
/**
 * Cleanup Logs Orchestrator
 *
 * Coordinates the cleanup of old log records across all log collections.
 * Handles batched deletion with proper tracing and error handling.
 *
 * @module orchestrator/infrastructure/cleanup_logs
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanup_logs = cleanup_logs;
const firestore_1 = require("firebase-admin/firestore");
const observability_1 = require("../../observability");
const infrastructure_1 = require("../../repositories/infrastructure");
const config_1 = require("../../infrastructure/config");
/**
 * Cleans up a single log collection.
 */
async function cleanup_collection(ctx, collection, retention_days, batch_size, max_batches) {
    const cutoff = firestore_1.Timestamp.fromMillis(Date.now() - retention_days * 24 * 60 * 60 * 1000);
    let total_deleted = 0;
    let batches_processed = 0;
    let batch_deleted = 0;
    do {
        const batch_ctx = (0, observability_1.create_child_span)(ctx);
        const result = await (0, infrastructure_1.delete_old_log_records)(batch_ctx, collection, cutoff, batch_size);
        batch_deleted = result.deleted_count;
        total_deleted += batch_deleted;
        batches_processed++;
    } while (batch_deleted === batch_size && batches_processed < max_batches);
    return {
        collection,
        deleted_count: total_deleted,
        batches_processed,
    };
}
/**
 * Orchestrates the cleanup of old log records.
 *
 * @param ctx - Trace context
 * @param config - Cleanup configuration
 * @returns Cleanup result
 */
async function cleanup_logs(ctx, config) {
    var _a, _b, _c, _d, _e, _f;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "cleanup_logs");
    (0, observability_1.log_operation_start)(span);
    // Get configuration from centralized config
    const infra_config = await (0, config_1.get_infrastructure_config)();
    const batch_size = (_a = config === null || config === void 0 ? void 0 : config.batch_size) !== null && _a !== void 0 ? _a : infra_config.cleanup_batch_size;
    const max_batches = (_b = config === null || config === void 0 ? void 0 : config.max_batches) !== null && _b !== void 0 ? _b : infra_config.cleanup_max_batches;
    const minimal_days = (_d = (_c = config === null || config === void 0 ? void 0 : config.retention) === null || _c === void 0 ? void 0 : _c.minimal_days) !== null && _d !== void 0 ? _d : infra_config.log_retention.minimal;
    // debug retention no longer read — `_logs_debug` cleanup is skipped (RC-A, see below).
    const traces_days = (_f = (_e = config === null || config === void 0 ? void 0 : config.retention) === null || _e === void 0 ? void 0 : _e.traces_days) !== null && _f !== void 0 ? _f : infra_config.log_retention.traces;
    try {
        // Clean up each collection sequentially to avoid overwhelming Firestore
        const minimal = await cleanup_collection(ctx, infrastructure_1.LOG_COLLECTIONS.MINIMAL, minimal_days, batch_size, max_batches);
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "cleanup_logs",
            status: "collection_complete",
            context: {
                name: "minimal",
                deleted_count: minimal.deleted_count,
                batches_processed: minimal.batches_processed,
            },
        }));
        // RC-A (Read-Cost-Reduction-Round-2): the `_logs_debug` cleanup scan dominated read cost
        // (~10k reads/day). With debug writes disabled (`log_async_debug` no-op), there is nothing to
        // clean, so we SKIP the scan entirely. Zero result preserves the response shape.
        const debug = {
            collection: infrastructure_1.LOG_COLLECTIONS.DEBUG,
            deleted_count: 0,
            batches_processed: 0,
        };
        const traces = await cleanup_collection(ctx, infrastructure_1.LOG_COLLECTIONS.TRACES, traces_days, batch_size, max_batches);
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "cleanup_logs",
            status: "collection_complete",
            context: {
                name: "traces",
                deleted_count: traces.deleted_count,
                batches_processed: traces.batches_processed,
            },
        }));
        const total_deleted = minimal.deleted_count + debug.deleted_count + traces.deleted_count;
        (0, observability_1.log_operation_success)(span);
        return {
            minimal,
            debug,
            traces,
            total_deleted,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { error_code: "CLEANUP_LOGS_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=cleanup_logs.orchestrator.js.map