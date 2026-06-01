/**
 * Quota Monitor
 *
 * High-level quota monitoring utilities built on the repository layer.
 * Tracks Firestore read/write quotas and triggers alerts when thresholds are exceeded.
 *
 * Note: Actual Firestore quota monitoring requires Cloud Monitoring API.
 * This implementation provides application-level tracking.
 *
 * @module infrastructure/quota_monitor
 */

import { TraceContext } from "../types";
import {
  QuotaSnapshotDoc,
  get_today_usage,
  increment_reads,
  increment_writes,
  save_quota_snapshot,
  get_latest_quota_snapshot,
} from "../repositories/infrastructure";

// Re-export types
export { QuotaSnapshotDoc as QuotaSnapshot } from "../repositories/infrastructure";

/**
 * Quota alert thresholds.
 */
export const QUOTA_THRESHOLDS = {
  WARNING: 80,  // 80% of quota
  CRITICAL: 95, // 95% of quota
} as const;

/**
 * Default daily limits (free tier).
 * Adjust based on your Firebase plan.
 */
export const DEFAULT_LIMITS = {
  DAILY_READS: 50_000,
  DAILY_WRITES: 20_000,
} as const;

/**
 * Increments the read counter for today.
 *
 * @param ctx - Trace context
 * @param count - Number of reads to add (default: 1)
 */
export async function track_reads(ctx: TraceContext, count = 1): Promise<void> {
  await increment_reads(ctx, count);
}

/**
 * Increments the write counter for today.
 *
 * @param ctx - Trace context
 * @param count - Number of writes to add (default: 1)
 */
export async function track_writes(ctx: TraceContext, count = 1): Promise<void> {
  await increment_writes(ctx, count);
}

/**
 * Gets current quota usage for today.
 *
 * @param ctx - Trace context
 * @returns Current reads and writes count
 */
export async function get_current_usage(
  ctx: TraceContext
): Promise<{ reads: number; writes: number }> {
  return get_today_usage(ctx);
}

/**
 * Creates a quota snapshot for health checks.
 * Should be called periodically (e.g., every hour).
 *
 * @param ctx - Trace context
 * @param limits - Custom limits (optional, defaults to free tier limits)
 * @returns The created snapshot
 */
export async function create_quota_snapshot(
  ctx: TraceContext,
  limits?: { daily_reads: number; daily_writes: number }
): Promise<QuotaSnapshotDoc> {
  const usage = await get_today_usage(ctx);

  const effective_limits = {
    daily_reads: limits?.daily_reads ?? DEFAULT_LIMITS.DAILY_READS,
    daily_writes: limits?.daily_writes ?? DEFAULT_LIMITS.DAILY_WRITES,
  };

  const snapshot = {
    reads_percent: Math.round((usage.reads / effective_limits.daily_reads) * 100),
    writes_percent: Math.round((usage.writes / effective_limits.daily_writes) * 100),
    reads_count: usage.reads,
    writes_count: usage.writes,
    limits: effective_limits,
  };

  await save_quota_snapshot(ctx, snapshot);

  return {
    ...snapshot,
    // Note: timestamp is added by the repository
  } as QuotaSnapshotDoc;
}

/**
 * Gets the latest quota snapshot.
 *
 * @param ctx - Trace context
 * @returns Latest snapshot or null if none exists
 */
export async function get_latest_snapshot(
  ctx: TraceContext
): Promise<QuotaSnapshotDoc | null> {
  return get_latest_quota_snapshot(ctx);
}

/**
 * Checks if quota usage is at warning or critical levels.
 *
 * @param ctx - Trace context
 * @returns Alert status
 */
export async function check_quota_alerts(ctx: TraceContext): Promise<{
  status: "ok" | "warning" | "critical";
  message?: string;
  reads_percent: number;
  writes_percent: number;
}> {
  const snapshot = await get_latest_quota_snapshot(ctx);

  if (!snapshot) {
    return {
      status: "ok",
      message: "No quota data available",
      reads_percent: 0,
      writes_percent: 0,
    };
  }

  const max_percent = Math.max(snapshot.reads_percent, snapshot.writes_percent);

  if (max_percent >= QUOTA_THRESHOLDS.CRITICAL) {
    const msg = `Quota critical: reads ${snapshot.reads_percent}%, ` +
      `writes ${snapshot.writes_percent}%`;
    return {
      status: "critical",
      message: msg,
      reads_percent: snapshot.reads_percent,
      writes_percent: snapshot.writes_percent,
    };
  }

  if (max_percent >= QUOTA_THRESHOLDS.WARNING) {
    const msg = `Quota warning: reads ${snapshot.reads_percent}%, ` +
      `writes ${snapshot.writes_percent}%`;
    return {
      status: "warning",
      message: msg,
      reads_percent: snapshot.reads_percent,
      writes_percent: snapshot.writes_percent,
    };
  }

  return {
    status: "ok",
    reads_percent: snapshot.reads_percent,
    writes_percent: snapshot.writes_percent,
  };
}
