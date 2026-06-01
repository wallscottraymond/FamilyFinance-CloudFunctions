/**
 * Idempotency Store
 *
 * High-level idempotency utilities built on the repository layer.
 * Provides convenient functions for common idempotency patterns.
 *
 * Keys expire after 24 hours (configurable).
 *
 * @module infrastructure/idempotency_store
 */

import { TraceContext } from "../types";
import {
  get_idempotency_record,
  update_idempotency_record,
  delete_idempotency_record,
  claim_idempotency_key,
  delete_expired_idempotency_records,
  get_active_idempotency_count,
} from "../repositories/infrastructure";

// Re-export repository types
export { IdempotencyRecord } from "../repositories/infrastructure";

/**
 * Default TTL for idempotency records (24 hours).
 */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Result of checking idempotency.
 */
export type IdempotencyCheckResult =
  | { is_duplicate: false }
  | { is_duplicate: true; status: "in_progress" }
  | { is_duplicate: true; status: "completed"; cached_result: unknown }
  | { is_duplicate: true; status: "failed"; error_message: string };

/**
 * Checks if an operation with this key has already been processed.
 *
 * @param ctx - Trace context
 * @param key - The idempotency key
 * @returns Check result indicating if this is a duplicate
 *
 * @example
 * const check = await check_idempotency(ctx, "user123:create_budget:abc");
 * if (check.is_duplicate) {
 *   if (check.status === "completed") {
 *     return check.cached_result;
 *   }
 *   if (check.status === "in_progress") {
 *     throw new Error("Operation in progress");
 *   }
 * }
 */
export async function check_idempotency(
  ctx: TraceContext,
  key: string
): Promise<IdempotencyCheckResult> {
  const record = await get_idempotency_record(ctx, key);

  if (!record) {
    return { is_duplicate: false };
  }

  switch (record.status) {
  case "in_progress":
    return { is_duplicate: true, status: "in_progress" };

  case "completed":
    return {
      is_duplicate: true,
      status: "completed",
      cached_result: record.result,
    };

  case "failed":
    return {
      is_duplicate: true,
      status: "failed",
      error_message: record.error_message ?? "Unknown error",
    };
  }
}

/**
 * Claims an idempotency key for processing.
 * Uses a transaction to ensure only one caller can claim the key.
 *
 * @param ctx - Trace context
 * @param key - The idempotency key
 * @param ttl_ms - TTL in milliseconds (default: 24 hours)
 * @returns true if claimed, false if already claimed
 *
 * @example
 * const claimed = await claim_key(ctx, "user123:create_budget:abc");
 * if (!claimed) {
 *   throw new Error("Operation already in progress");
 * }
 */
export async function claim_key(
  ctx: TraceContext,
  key: string,
  ttl_ms: number = DEFAULT_TTL_MS
): Promise<boolean> {
  return claim_idempotency_key(ctx, key, ttl_ms);
}

/**
 * Marks an idempotency key as completed with a cached result.
 *
 * @param ctx - Trace context
 * @param key - The idempotency key
 * @param result - The result to cache
 *
 * @example
 * await complete_key(ctx, "user123:create_budget:abc", { budget_id: "xyz" });
 */
export async function complete_key(
  ctx: TraceContext,
  key: string,
  result: unknown
): Promise<void> {
  await update_idempotency_record(ctx, key, {
    status: "completed",
    result,
  });
}

/**
 * Marks an idempotency key as failed.
 *
 * @param ctx - Trace context
 * @param key - The idempotency key
 * @param error_message - Error message to store
 *
 * @example
 * await fail_key(ctx, "user123:create_budget:abc", "Validation failed");
 */
export async function fail_key(
  ctx: TraceContext,
  key: string,
  error_message: string
): Promise<void> {
  await update_idempotency_record(ctx, key, {
    status: "failed",
    error_message,
  });
}

/**
 * Releases an idempotency key (removes the in_progress record).
 * Use this when you want to allow retry without waiting for expiration.
 *
 * @param ctx - Trace context
 * @param key - The idempotency key
 */
export async function release_key(ctx: TraceContext, key: string): Promise<void> {
  await delete_idempotency_record(ctx, key);
}

/**
 * Deletes expired idempotency records.
 * Called by scheduled cleanup job.
 *
 * @param ctx - Trace context
 * @param batch_size - Maximum records to delete per batch
 * @returns Number of records deleted
 */
export async function cleanup_expired_records(
  ctx: TraceContext,
  batch_size = 500
): Promise<number> {
  const result = await delete_expired_idempotency_records(ctx, batch_size);
  return result.deleted_count;
}

/**
 * Gets count of active (non-expired) idempotency records.
 * Useful for monitoring.
 *
 * @param ctx - Trace context
 */
export async function get_active_count(ctx: TraceContext): Promise<number> {
  return get_active_idempotency_count(ctx);
}
