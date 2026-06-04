"use strict";
/**
 * Cleanup Trigger Processing Orchestrator
 *
 * Coordinates the cleanup of old trigger processing records.
 * Handles batched deletion with proper tracing and error handling.
 *
 * @module orchestrator/infrastructure/cleanup_trigger_processing
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanup_trigger_processing = cleanup_trigger_processing;
const firestore_1 = require("firebase-admin/firestore");
const observability_1 = require("../../observability");
const infrastructure_1 = require("../../repositories/infrastructure");
const config_1 = require("../../infrastructure/config");
/**
 * Orchestrates the cleanup of old trigger processing records.
 *
 * @param ctx - Trace context
 * @param config - Cleanup configuration
 * @returns Cleanup result
 */
async function cleanup_trigger_processing(ctx, config) {
    var _a, _b, _c;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "cleanup_trigger_processing");
    (0, observability_1.log_operation_start)(span);
    // Get configuration from centralized config
    const infra_config = await (0, config_1.get_infrastructure_config)();
    const retention_days = (_a = config === null || config === void 0 ? void 0 : config.retention_days) !== null && _a !== void 0 ? _a : infra_config.trigger_retention_days;
    const batch_size = (_b = config === null || config === void 0 ? void 0 : config.batch_size) !== null && _b !== void 0 ? _b : infra_config.cleanup_batch_size;
    const max_batches = (_c = config === null || config === void 0 ? void 0 : config.max_batches) !== null && _c !== void 0 ? _c : infra_config.cleanup_max_batches;
    const cutoff = firestore_1.Timestamp.fromMillis(Date.now() - retention_days * 24 * 60 * 60 * 1000);
    let total_deleted = 0;
    let batches_processed = 0;
    let batch_deleted = 0;
    try {
        do {
            const batch_ctx = (0, observability_1.create_child_span)(ctx);
            const result = await (0, infrastructure_1.delete_old_trigger_records)(batch_ctx, cutoff, batch_size);
            batch_deleted = result.deleted_count;
            total_deleted += batch_deleted;
            batches_processed++;
            if (batch_deleted > 0) {
                (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
                    trace_id: ctx.trace_id,
                    span_id: span.span_id,
                    layer: "orchestrator",
                    function: "cleanup_trigger_processing",
                    status: "batch_complete",
                    context: {
                        batch_number: batches_processed,
                        batch_deleted,
                        total_deleted,
                    },
                }));
            }
        } while (batch_deleted === batch_size && batches_processed < max_batches);
        const completed = batch_deleted < batch_size;
        (0, observability_1.log_operation_success)(span);
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "cleanup_trigger_processing",
            status: "success",
            output: {
                total_deleted,
                batches_processed,
                completed,
                retention_days,
            },
        }));
        return {
            total_deleted,
            batches_processed,
            completed,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { error_code: "CLEANUP_TRIGGER_PROCESSING_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=cleanup_trigger_processing.orchestrator.js.map