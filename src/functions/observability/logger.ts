/**
 * Two-Tier Logging System
 *
 * Tier 1 (Sync): Minimal, fast, synchronous logging for critical events
 * Tier 2 (Async): Detailed, asynchronous logging for debugging
 *
 * Performance target: < 5ms sync logging overhead
 *
 * @module observability/logger
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../types";
import { SpanContext, should_log_tier2 } from "./tracer";

/**
 * Log entry for Tier 1 (minimal) logs.
 * Written synchronously, kept for 30 days.
 */
export interface MinimalLogEntry {
  /** Trace ID for correlation */
  trace_id: string;

  /** Span ID for this specific execution */
  span_id: string;

  /** Architectural layer */
  layer: string;

  /** Function name */
  function: string;

  /** Status: start, success, error, idempotent_return, etc. */
  status: string;

  /** Duration in milliseconds (for end events) */
  duration_ms?: number;

  /** Error code if status is error */
  error_code?: string;

  /** User ID if available */
  user_id?: string;

  /** Timestamp */
  timestamp: Timestamp;
}

/**
 * Log entry for Tier 2 (debug) logs.
 * Written asynchronously, kept for 7 days.
 */
export interface DebugLogEntry extends MinimalLogEntry {
  /** Full input data */
  inputs?: unknown;

  /** Decision/dependency data */
  decisions?: unknown;

  /** Write results */
  writes?: unknown;

  /** Output data */
  output?: unknown;

  /** Performance metrics */
  performance?: {
    reads: number;
    writes: number;
    time_ms: number;
  };

  /** Error details */
  error_details?: {
    message: string;
    stack?: string;
    details?: unknown;
  };

  /** Any additional context */
  context?: Record<string, unknown>;
}

/**
 * Firestore collection names for logs.
 */
const COLLECTIONS = {
  MINIMAL: "_logs_minimal",
  DEBUG: "_logs_debug",
  TRACES: "_traces",
} as const;

/**
 * Fire-and-forget helper for async operations.
 * MUST swallow errors to prevent logging failures from affecting business execution.
 *
 * @example
 * fire_and_forget(() => log_async_debug({ ... }));
 */
export function fire_and_forget(fn: () => Promise<void>): void {
  fn().catch(() => {
    // Swallow errors - logging failures MUST NOT affect business execution
    // In production, you might want to increment a metric here
  });
}

/**
 * Logs a minimal (Tier 1) entry synchronously.
 * Use for critical events: start, success, error, idempotent_return.
 *
 * Performance: Should complete in < 5ms
 *
 * @example
 * log_minimal({
 *   ...span,
 *   layer: "orchestrator",
 *   function: "create_transaction",
 *   status: "start"
 * });
 */
export function log_minimal(entry: {
  trace_id: string;
  span_id: string;
  layer: string;
  function: string;
  status: string;
  duration_ms?: number;
  error_code?: string;
  user_id?: string;
}): void {
  const log_entry: MinimalLogEntry = {
    ...entry,
    timestamp: Timestamp.now(),
  };

  // Use console.log for immediate visibility in Cloud Functions logs
  // This is synchronous and fast
  console.log(JSON.stringify({
    severity: entry.status === "error" ? "ERROR" : "INFO",
    ...log_entry,
  }));

  // Also write to Firestore asynchronously (fire-and-forget)
  fire_and_forget(async () => {
    const db = getFirestore();
    await db.collection(COLLECTIONS.MINIMAL).add(log_entry);
  });
}

/**
 * Logs a detailed (Tier 2) entry asynchronously.
 * Only use when Tier 2 logging is enabled (debug_mode, error, or sampling).
 *
 * This is fire-and-forget - failures are swallowed.
 *
 * @example
 * fire_and_forget(() => log_async_debug({
 *   ...span,
 *   inputs: ctx.input,
 *   writes: write_results,
 *   output: result
 * }));
 */
export async function log_async_debug(entry: {
  trace_id: string;
  span_id: string;
  layer?: string;
  function?: string;
  status?: string;
  inputs?: unknown;
  decisions?: unknown;
  writes?: unknown;
  output?: unknown;
  performance?: { reads: number; writes: number; time_ms: number };
  error_details?: { message: string; stack?: string; details?: unknown };
  context?: Record<string, unknown>;
}): Promise<void> {
  const log_entry: DebugLogEntry = {
    trace_id: entry.trace_id,
    span_id: entry.span_id,
    layer: entry.layer ?? "unknown",
    function: entry.function ?? "unknown",
    status: entry.status ?? "debug",
    timestamp: Timestamp.now(),
    inputs: entry.inputs,
    decisions: entry.decisions,
    writes: entry.writes,
    output: entry.output,
    performance: entry.performance,
    error_details: entry.error_details,
    context: entry.context,
  };

  const db = getFirestore();
  await db.collection(COLLECTIONS.DEBUG).add(log_entry);
}

/**
 * Logs the start of an operation.
 * Creates a Tier 1 log entry.
 */
export function log_operation_start(
  span: SpanContext,
  user_id?: string
): void {
  log_minimal({
    trace_id: span.trace_id,
    span_id: span.span_id,
    layer: span.layer,
    function: span.function,
    status: "start",
    user_id,
  });
}

/**
 * Logs the successful completion of an operation.
 * Creates a Tier 1 log entry with duration.
 */
export function log_operation_success(
  span: SpanContext,
  user_id?: string
): void {
  const duration_ms = Date.now() - span.started_at;

  log_minimal({
    trace_id: span.trace_id,
    span_id: span.span_id,
    layer: span.layer,
    function: span.function,
    status: "success",
    duration_ms,
    user_id,
  });
}

/**
 * Logs an error during an operation.
 * Creates a Tier 1 log entry and optionally a Tier 2 entry with details.
 */
export function log_operation_error(
  span: SpanContext,
  error: Error,
  options?: {
    user_id?: string;
    error_code?: string;
    context?: Record<string, unknown>;
  }
): void {
  const duration_ms = Date.now() - span.started_at;

  // Tier 1: Minimal log
  log_minimal({
    trace_id: span.trace_id,
    span_id: span.span_id,
    layer: span.layer,
    function: span.function,
    status: "error",
    duration_ms,
    error_code: options?.error_code ?? "UNKNOWN_ERROR",
    user_id: options?.user_id,
  });

  // Tier 2: Detailed error log (always log errors to debug collection)
  fire_and_forget(() => log_async_debug({
    trace_id: span.trace_id,
    span_id: span.span_id,
    layer: span.layer,
    function: span.function,
    status: "error",
    error_details: {
      message: error.message,
      stack: error.stack,
      details: options?.context,
    },
    context: options?.context,
  }));
}

/**
 * Logs an idempotent return (cached response).
 */
export function log_idempotent_return(
  span: SpanContext,
  user_id?: string
): void {
  log_minimal({
    trace_id: span.trace_id,
    span_id: span.span_id,
    layer: span.layer,
    function: span.function,
    status: "idempotent_return",
    user_id,
  });
}

/**
 * Logs when work is deferred to background processing.
 */
export function log_deferred_to_background(
  span: SpanContext,
  job_type: string,
  user_id?: string
): void {
  log_minimal({
    trace_id: span.trace_id,
    span_id: span.span_id,
    layer: span.layer,
    function: span.function,
    status: "deferred_to_background",
    user_id,
  });

  // Log additional detail
  fire_and_forget(() => log_async_debug({
    trace_id: span.trace_id,
    span_id: span.span_id,
    layer: span.layer,
    function: span.function,
    status: "deferred_to_background",
    context: { job_type },
  }));
}

/**
 * Conditionally logs debug information if Tier 2 is enabled.
 * Use this for detailed logging that should only occur in debug mode.
 */
export function log_debug_if_enabled(
  trace: TraceContext,
  data: {
    layer?: string;
    function?: string;
    inputs?: unknown;
    decisions?: unknown;
    writes?: unknown;
    output?: unknown;
    performance?: { reads: number; writes: number; time_ms: number };
    context?: Record<string, unknown>;
  },
  options?: {
    has_error?: boolean;
    force_sample?: boolean;
  }
): void {
  if (should_log_tier2(trace, options)) {
    fire_and_forget(() => log_async_debug({
      trace_id: trace.trace_id,
      span_id: trace.span_id,
      ...data,
    }));
  }
}

/**
 * Creates a trace summary document.
 * Called at the end of a request to summarize the trace.
 */
export async function log_trace_summary(
  trace_id: string,
  summary: {
    entry_function: string;
    user_id?: string;
    total_duration_ms: number;
    status: "success" | "error" | "partial";
    spans_count: number;
    reads_count: number;
    writes_count: number;
    error_code?: string;
  }
): Promise<void> {
  const db = getFirestore();
  await db.collection(COLLECTIONS.TRACES).doc(trace_id).set({
    ...summary,
    trace_id,
    timestamp: Timestamp.now(),
  });
}
