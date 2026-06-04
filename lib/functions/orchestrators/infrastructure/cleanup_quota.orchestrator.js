"use strict";
/**
 * Cleanup Quota Orchestrator
 *
 * Coordinates the cleanup of old quota tracking and snapshot data.
 * Handles batched deletion with proper tracing and error handling.
 *
 * @module orchestrator/infrastructure/cleanup_quota
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanup_quota = cleanup_quota;
const firestore_1 = require("firebase-admin/firestore");
const observability_1 = require("../../observability");
const infrastructure_1 = require("../../repositories/infrastructure");
const config_1 = require("../../infrastructure/config");
/**
 * Orchestrates the cleanup of old quota data.
 *
 * @param ctx - Trace context
 * @param config - Cleanup configuration
 * @returns Cleanup result
 */
async function cleanup_quota(ctx, config) {
    var _a, _b, _c;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "cleanup_quota");
    (0, observability_1.log_operation_start)(span);
    // Get configuration from centralized config
    const infra_config = await (0, config_1.get_infrastructure_config)();
    const retention_days = (_a = config === null || config === void 0 ? void 0 : config.retention_days) !== null && _a !== void 0 ? _a : infra_config.quota_retention_days;
    const batch_size = (_b = config === null || config === void 0 ? void 0 : config.batch_size) !== null && _b !== void 0 ? _b : infra_config.cleanup_batch_size;
    const max_batches = (_c = config === null || config === void 0 ? void 0 : config.max_batches) !== null && _c !== void 0 ? _c : infra_config.cleanup_max_batches;
    // Calculate cutoffs
    const cutoff_date = new Date();
    cutoff_date.setDate(cutoff_date.getDate() - retention_days);
    const cutoff_string = cutoff_date.toISOString().split("T")[0];
    const cutoff_timestamp = firestore_1.Timestamp.fromDate(cutoff_date);
    try {
        // Clean up tracking data
        let tracking_deleted = 0;
        let batches_processed = 0;
        let batch_deleted = 0;
        do {
            const batch_ctx = (0, observability_1.create_child_span)(ctx);
            const result = await (0, infrastructure_1.delete_old_quota_tracking)(batch_ctx, cutoff_string, batch_size);
            batch_deleted = result.deleted_count;
            tracking_deleted += batch_deleted;
            batches_processed++;
        } while (batch_deleted === batch_size && batches_processed < max_batches);
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "cleanup_quota",
            status: "tracking_complete",
            context: { tracking_deleted, batches_processed },
        }));
        // Clean up snapshots
        let snapshots_deleted = 0;
        batches_processed = 0;
        batch_deleted = 0;
        do {
            const batch_ctx = (0, observability_1.create_child_span)(ctx);
            const result = await (0, infrastructure_1.delete_old_quota_snapshots)(batch_ctx, cutoff_timestamp, batch_size);
            batch_deleted = result.deleted_count;
            snapshots_deleted += batch_deleted;
            batches_processed++;
        } while (batch_deleted === batch_size && batches_processed < max_batches);
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "cleanup_quota",
            status: "snapshots_complete",
            context: { snapshots_deleted, batches_processed },
        }));
        const total_deleted = tracking_deleted + snapshots_deleted;
        (0, observability_1.log_operation_success)(span);
        return {
            tracking_deleted,
            snapshots_deleted,
            total_deleted,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { error_code: "CLEANUP_QUOTA_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=cleanup_quota.orchestrator.js.map