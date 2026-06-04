"use strict";
/**
 * Purge Soft Deleted Orchestrator
 *
 * Coordinates the permanent deletion of soft-deleted records.
 * Handles batched deletion across multiple collections.
 *
 * @module orchestrator/infrastructure/purge_soft_deleted
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.purge_soft_deleted = purge_soft_deleted;
const firestore_1 = require("firebase-admin/firestore");
const observability_1 = require("../../observability");
const infrastructure_1 = require("../../repositories/infrastructure");
const config_1 = require("../../infrastructure/config");
/**
 * Purges soft-deleted records from a single collection.
 */
async function purge_collection(ctx, collection, cutoff, batch_size, max_batches) {
    let total_purged = 0;
    let batches_processed = 0;
    let batch_purged = 0;
    do {
        const batch_ctx = (0, observability_1.create_child_span)(ctx);
        const result = await (0, infrastructure_1.purge_deleted_records)(batch_ctx, collection, cutoff, batch_size);
        batch_purged = result.purged_count;
        total_purged += batch_purged;
        batches_processed++;
    } while (batch_purged === batch_size && batches_processed < max_batches);
    return {
        collection,
        purged_count: total_purged,
        batches_processed,
    };
}
/**
 * Orchestrates the permanent deletion of soft-deleted records.
 *
 * @param ctx - Trace context
 * @param config - Purge configuration
 * @returns Purge result
 */
async function purge_soft_deleted(ctx, config) {
    var _a, _b, _c, _d;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "purge_soft_deleted");
    (0, observability_1.log_operation_start)(span);
    // Get configuration from centralized config
    const infra_config = await (0, config_1.get_infrastructure_config)();
    const retention_days = (_a = config === null || config === void 0 ? void 0 : config.retention_days) !== null && _a !== void 0 ? _a : infra_config.soft_delete_retention_days;
    const batch_size = (_b = config === null || config === void 0 ? void 0 : config.batch_size) !== null && _b !== void 0 ? _b : infra_config.cleanup_batch_size;
    const max_batches = (_c = config === null || config === void 0 ? void 0 : config.max_batches) !== null && _c !== void 0 ? _c : infra_config.cleanup_max_batches;
    const collections = (_d = config === null || config === void 0 ? void 0 : config.collections) !== null && _d !== void 0 ? _d : infrastructure_1.SOFT_DELETE_COLLECTIONS;
    const cutoff = firestore_1.Timestamp.fromMillis(Date.now() - retention_days * 24 * 60 * 60 * 1000);
    try {
        const results = [];
        let total_purged = 0;
        for (const collection of collections) {
            const result = await purge_collection(ctx, collection, cutoff, batch_size, max_batches);
            results.push(result);
            total_purged += result.purged_count;
            if (result.purged_count > 0) {
                (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
                    trace_id: ctx.trace_id,
                    span_id: span.span_id,
                    layer: "orchestrator",
                    function: "purge_soft_deleted",
                    status: "collection_complete",
                    context: {
                        collection: result.collection,
                        purged_count: result.purged_count,
                        batches_processed: result.batches_processed,
                    },
                }));
            }
        }
        (0, observability_1.log_operation_success)(span);
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "purge_soft_deleted",
            status: "success",
            output: {
                total_purged,
                collections_processed: collections.length,
                retention_days,
            },
        }));
        return {
            collections: results,
            total_purged,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { error_code: "PURGE_SOFT_DELETED_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=purge_soft_deleted.orchestrator.js.map