"use strict";
/**
 * Cleanup Idempotency Orchestrator
 *
 * Coordinates the cleanup of expired idempotency records.
 * Handles batched deletion with proper tracing and error handling.
 *
 * @module orchestrator/infrastructure/cleanup_idempotency
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanup_idempotency = cleanup_idempotency;
const observability_1 = require("../../observability");
const infrastructure_1 = require("../../repositories/infrastructure");
/**
 * Orchestrates the cleanup of expired idempotency records.
 *
 * @param ctx - Trace context
 * @param config - Cleanup configuration
 * @returns Cleanup result
 */
async function cleanup_idempotency(ctx, config) {
    var _a, _b;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "cleanup_idempotency");
    (0, observability_1.log_operation_start)(span);
    const batch_size = (_a = config === null || config === void 0 ? void 0 : config.batch_size) !== null && _a !== void 0 ? _a : 500;
    const max_batches = (_b = config === null || config === void 0 ? void 0 : config.max_batches) !== null && _b !== void 0 ? _b : 20;
    let total_deleted = 0;
    let batches_processed = 0;
    let batch_deleted = 0;
    try {
        do {
            const batch_ctx = (0, observability_1.create_child_span)(ctx);
            const result = await (0, infrastructure_1.delete_expired_idempotency_records)(batch_ctx, batch_size);
            batch_deleted = result.deleted_count;
            total_deleted += batch_deleted;
            batches_processed++;
            // Log progress for each batch
            if (batch_deleted > 0) {
                (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
                    trace_id: ctx.trace_id,
                    span_id: span.span_id,
                    layer: "orchestrator",
                    function: "cleanup_idempotency",
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
        // Log final summary
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "cleanup_idempotency",
            status: "success",
            output: {
                total_deleted,
                batches_processed,
                completed,
            },
        }));
        return {
            total_deleted,
            batches_processed,
            completed,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { error_code: "CLEANUP_IDEMPOTENCY_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=cleanup_idempotency.orchestrator.js.map