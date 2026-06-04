/**
 * Cleanup Relink Attempts Orchestrator
 *
 * Coordinates retention cleanup of old Plaid relink-attempt records. The repo
 * deletes up to 500 per call, so this drains in batches up to a safety limit.
 *
 * @module orchestrator/infrastructure/cleanup_relink_attempts
 */
import { TraceContext } from "../../types";
/** Result of the cleanup operation. */
export interface CleanupRelinkAttemptsResult {
    total_deleted: number;
    batches_processed: number;
    completed: boolean;
}
/** Configuration for the cleanup. */
export interface CleanupRelinkAttemptsConfig {
    /** Records older than this are deleted (default: 30 days). */
    retention_days?: number;
    /** Safety cap on batches per run (default: 20). */
    max_batches?: number;
}
/**
 * Orchestrates the cleanup of old relink-attempt records.
 *
 * @param ctx - Trace context
 * @param config - Cleanup configuration
 * @returns Cleanup result
 */
export declare function cleanup_relink_attempts(ctx: TraceContext, config?: CleanupRelinkAttemptsConfig): Promise<CleanupRelinkAttemptsResult>;
//# sourceMappingURL=cleanup_relink_attempts.orchestrator.d.ts.map