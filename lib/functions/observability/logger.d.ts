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
import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../types";
import { SpanContext } from "./tracer";
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
 * Fire-and-forget helper for async operations.
 * MUST swallow errors to prevent logging failures from affecting business execution.
 *
 * @example
 * fire_and_forget(() => log_async_debug({ ... }));
 */
export declare function fire_and_forget(fn: () => Promise<void>): void;
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
export declare function log_minimal(entry: {
    trace_id: string;
    span_id: string;
    layer: string;
    function: string;
    status: string;
    duration_ms?: number;
    error_code?: string;
    user_id?: string;
}): void;
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
export declare function log_async_debug(entry: {
    trace_id: string;
    span_id: string;
    layer?: string;
    function?: string;
    status?: string;
    inputs?: unknown;
    decisions?: unknown;
    writes?: unknown;
    output?: unknown;
    performance?: {
        reads: number;
        writes: number;
        time_ms: number;
    };
    error_details?: {
        message: string;
        stack?: string;
        details?: unknown;
    };
    context?: Record<string, unknown>;
}): Promise<void>;
/**
 * Logs the start of an operation.
 * Creates a Tier 1 log entry.
 */
export declare function log_operation_start(span: SpanContext, user_id?: string): void;
/**
 * Logs the successful completion of an operation.
 * Creates a Tier 1 log entry with duration.
 */
export declare function log_operation_success(span: SpanContext, user_id?: string): void;
/**
 * Logs an error during an operation.
 * Creates a Tier 1 log entry and optionally a Tier 2 entry with details.
 */
export declare function log_operation_error(span: SpanContext, error: Error, options?: {
    user_id?: string;
    error_code?: string;
    context?: Record<string, unknown>;
}): void;
/**
 * Logs an idempotent return (cached response).
 */
export declare function log_idempotent_return(span: SpanContext, user_id?: string): void;
/**
 * Logs when work is deferred to background processing.
 */
export declare function log_deferred_to_background(span: SpanContext, job_type: string, user_id?: string): void;
/**
 * Conditionally logs debug information if Tier 2 is enabled.
 * Use this for detailed logging that should only occur in debug mode.
 */
export declare function log_debug_if_enabled(trace: TraceContext, data: {
    layer?: string;
    function?: string;
    inputs?: unknown;
    decisions?: unknown;
    writes?: unknown;
    output?: unknown;
    performance?: {
        reads: number;
        writes: number;
        time_ms: number;
    };
    context?: Record<string, unknown>;
}, options?: {
    has_error?: boolean;
    force_sample?: boolean;
}): void;
/**
 * Creates a trace summary document.
 * Called at the end of a request to summarize the trace.
 */
export declare function log_trace_summary(trace_id: string, summary: {
    entry_function: string;
    user_id?: string;
    total_duration_ms: number;
    status: "success" | "error" | "partial";
    spans_count: number;
    reads_count: number;
    writes_count: number;
    error_code?: string;
}): Promise<void>;
//# sourceMappingURL=logger.d.ts.map