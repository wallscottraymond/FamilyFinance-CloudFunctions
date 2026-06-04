"use strict";
/**
 * Cleanup Relink Attempts Orchestrator
 *
 * Coordinates retention cleanup of old Plaid relink-attempt records. The repo
 * deletes up to 500 per call, so this drains in batches up to a safety limit.
 *
 * @module orchestrator/infrastructure/cleanup_relink_attempts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanup_relink_attempts = cleanup_relink_attempts;
const observability_1 = require("../../observability");
const relink_attempt_repo_1 = require("../../repositories/plaid/relink_attempt.repo");
/** Default retention for relink-attempt records (days). */
const DEFAULT_RETENTION_DAYS = 30;
/** Repo delete batch size (matches `cleanup_old_attempts`). */
const BATCH_SIZE = 500;
/**
 * Orchestrates the cleanup of old relink-attempt records.
 *
 * @param ctx - Trace context
 * @param config - Cleanup configuration
 * @returns Cleanup result
 */
async function cleanup_relink_attempts(ctx, config) {
    var _a, _b;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "cleanup_relink_attempts");
    (0, observability_1.log_operation_start)(span);
    const retention_days = (_a = config === null || config === void 0 ? void 0 : config.retention_days) !== null && _a !== void 0 ? _a : DEFAULT_RETENTION_DAYS;
    const max_batches = (_b = config === null || config === void 0 ? void 0 : config.max_batches) !== null && _b !== void 0 ? _b : 20;
    let total_deleted = 0;
    let batches_processed = 0;
    let batch_deleted = 0;
    try {
        do {
            const batch_ctx = (0, observability_1.create_child_span)(ctx);
            batch_deleted = await relink_attempt_repo_1.relink_attempt_repo.cleanup_old_attempts(batch_ctx, retention_days);
            total_deleted += batch_deleted;
            batches_processed++;
        } while (batch_deleted === BATCH_SIZE && batches_processed < max_batches);
        const completed = batch_deleted < BATCH_SIZE;
        (0, observability_1.log_operation_success)(span);
        return { total_deleted, batches_processed, completed };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { error_code: "CLEANUP_RELINK_ATTEMPTS_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=cleanup_relink_attempts.orchestrator.js.map