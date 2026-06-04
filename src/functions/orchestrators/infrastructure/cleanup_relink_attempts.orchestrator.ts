/**
 * Cleanup Relink Attempts Orchestrator
 *
 * Coordinates retention cleanup of old Plaid relink-attempt records. The repo
 * deletes up to 500 per call, so this drains in batches up to a safety limit.
 *
 * @module orchestrator/infrastructure/cleanup_relink_attempts
 */

import { TraceContext } from "../../types";
import {
  create_span,
  create_child_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { relink_attempt_repo } from "../../repositories/plaid/relink_attempt.repo";

/** Default retention for relink-attempt records (days). */
const DEFAULT_RETENTION_DAYS = 30;

/** Repo delete batch size (matches `cleanup_old_attempts`). */
const BATCH_SIZE = 500;

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
export async function cleanup_relink_attempts(
  ctx: TraceContext,
  config?: CleanupRelinkAttemptsConfig
): Promise<CleanupRelinkAttemptsResult> {
  const span = create_span(ctx, "orchestrator", "cleanup_relink_attempts");
  log_operation_start(span);

  const retention_days = config?.retention_days ?? DEFAULT_RETENTION_DAYS;
  const max_batches = config?.max_batches ?? 20;

  let total_deleted = 0;
  let batches_processed = 0;
  let batch_deleted = 0;

  try {
    do {
      const batch_ctx = create_child_span(ctx);
      batch_deleted = await relink_attempt_repo.cleanup_old_attempts(
        batch_ctx,
        retention_days
      );
      total_deleted += batch_deleted;
      batches_processed++;
    } while (batch_deleted === BATCH_SIZE && batches_processed < max_batches);

    const completed = batch_deleted < BATCH_SIZE;
    log_operation_success(span);

    return { total_deleted, batches_processed, completed };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { error_code: "CLEANUP_RELINK_ATTEMPTS_FAILED" }
    );
    throw error;
  }
}
