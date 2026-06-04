"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.fire_and_forget = fire_and_forget;
exports.log_minimal = log_minimal;
exports.log_async_debug = log_async_debug;
exports.log_operation_start = log_operation_start;
exports.log_operation_success = log_operation_success;
exports.log_operation_error = log_operation_error;
exports.log_idempotent_return = log_idempotent_return;
exports.log_deferred_to_background = log_deferred_to_background;
exports.log_debug_if_enabled = log_debug_if_enabled;
exports.log_trace_summary = log_trace_summary;
const firestore_1 = require("firebase-admin/firestore");
const tracer_1 = require("./tracer");
/**
 * Firestore collection names for logs.
 */
const COLLECTIONS = {
    MINIMAL: "_logs_minimal",
    DEBUG: "_logs_debug",
    TRACES: "_traces",
};
/**
 * Fire-and-forget helper for async operations.
 * MUST swallow errors to prevent logging failures from affecting business execution.
 *
 * @example
 * fire_and_forget(() => log_async_debug({ ... }));
 */
function fire_and_forget(fn) {
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
function log_minimal(entry) {
    const log_entry = Object.assign(Object.assign({}, entry), { timestamp: firestore_1.Timestamp.now() });
    // Use console.log for immediate visibility in Cloud Functions logs
    // This is synchronous and fast
    console.log(JSON.stringify(Object.assign({ severity: entry.status === "error" ? "ERROR" : "INFO" }, log_entry)));
    // Also write to Firestore asynchronously (fire-and-forget)
    fire_and_forget(async () => {
        const db = (0, firestore_1.getFirestore)();
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
async function log_async_debug(entry) {
    var _a, _b, _c;
    const log_entry = {
        trace_id: entry.trace_id,
        span_id: entry.span_id,
        layer: (_a = entry.layer) !== null && _a !== void 0 ? _a : "unknown",
        function: (_b = entry.function) !== null && _b !== void 0 ? _b : "unknown",
        status: (_c = entry.status) !== null && _c !== void 0 ? _c : "debug",
        timestamp: firestore_1.Timestamp.now(),
        inputs: entry.inputs,
        decisions: entry.decisions,
        writes: entry.writes,
        output: entry.output,
        performance: entry.performance,
        error_details: entry.error_details,
        context: entry.context,
    };
    const db = (0, firestore_1.getFirestore)();
    await db.collection(COLLECTIONS.DEBUG).add(log_entry);
}
/**
 * Logs the start of an operation.
 * Creates a Tier 1 log entry.
 */
function log_operation_start(span, user_id) {
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
function log_operation_success(span, user_id) {
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
function log_operation_error(span, error, options) {
    var _a;
    const duration_ms = Date.now() - span.started_at;
    // Tier 1: Minimal log
    log_minimal({
        trace_id: span.trace_id,
        span_id: span.span_id,
        layer: span.layer,
        function: span.function,
        status: "error",
        duration_ms,
        error_code: (_a = options === null || options === void 0 ? void 0 : options.error_code) !== null && _a !== void 0 ? _a : "UNKNOWN_ERROR",
        user_id: options === null || options === void 0 ? void 0 : options.user_id,
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
            details: options === null || options === void 0 ? void 0 : options.context,
        },
        context: options === null || options === void 0 ? void 0 : options.context,
    }));
}
/**
 * Logs an idempotent return (cached response).
 */
function log_idempotent_return(span, user_id) {
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
function log_deferred_to_background(span, job_type, user_id) {
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
function log_debug_if_enabled(trace, data, options) {
    if ((0, tracer_1.should_log_tier2)(trace, options)) {
        fire_and_forget(() => log_async_debug(Object.assign({ trace_id: trace.trace_id, span_id: trace.span_id }, data)));
    }
}
/**
 * Creates a trace summary document.
 * Called at the end of a request to summarize the trace.
 */
async function log_trace_summary(trace_id, summary) {
    const db = (0, firestore_1.getFirestore)();
    await db.collection(COLLECTIONS.TRACES).doc(trace_id).set(Object.assign(Object.assign({}, summary), { trace_id, timestamp: firestore_1.Timestamp.now() }));
}
//# sourceMappingURL=logger.js.map