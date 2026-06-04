"use strict";
/**
 * Trace Context Creation and Propagation
 *
 * Provides trace context for observability across all layers.
 * Every operation carries a trace_id for debugging and correlation.
 *
 * @module observability/tracer
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generate_id = generate_id;
exports.create_trace_context = create_trace_context;
exports.create_child_span = create_child_span;
exports.create_span = create_span;
exports.get_span_duration = get_span_duration;
exports.should_log_tier2 = should_log_tier2;
exports.extract_trace_from_request = extract_trace_from_request;
exports.create_trigger_trace = create_trigger_trace;
/**
 * Generates a UUID v4 for trace and span IDs.
 */
function generate_id() {
    return crypto.randomUUID();
}
/**
 * Creates a new root trace context.
 * Use this at the Entry layer when a new request arrives.
 *
 * @param debug_mode - Enable full Tier 2 logging for this trace
 *
 * @example
 * const trace = create_trace_context();
 * // trace = { trace_id: "abc...", span_id: "def...", debug_mode: false }
 */
function create_trace_context(debug_mode = false) {
    const id = generate_id();
    return {
        trace_id: id,
        span_id: id, // Root span has same ID as trace
        debug_mode,
    };
}
/**
 * Creates a child span from an existing trace context.
 * Use this when calling a new layer or function within the same trace.
 *
 * The child span:
 * - Keeps the same trace_id (for correlation)
 * - Gets a new span_id (for this specific execution)
 * - Records the parent span_id as causation_id
 * - Inherits debug_mode
 *
 * @example
 * // In orchestrator calling resolver
 * const resolver_span = create_child_span(ctx);
 * const deps = await resolve_dependencies({ ...ctx, ...resolver_span });
 */
function create_child_span(parent) {
    return {
        trace_id: parent.trace_id,
        span_id: generate_id(),
        causation_id: parent.span_id,
        debug_mode: parent.debug_mode,
    };
}
/**
 * Creates a span context object suitable for logging.
 * Adds common metadata to the trace context.
 *
 * @param trace - The trace context
 * @param layer - The architectural layer (entry, orchestrator, resolver, domain, repository)
 * @param function_name - Name of the function being executed
 */
function create_span(trace, layer, function_name) {
    return Object.assign(Object.assign({}, trace), { layer, function: function_name, started_at: Date.now() });
}
/**
 * Calculates span duration in milliseconds.
 */
function get_span_duration(span) {
    return Date.now() - span.started_at;
}
/**
 * Determines if Tier 2 (detailed) logging should be enabled for this span.
 *
 * Tier 2 logging is enabled when:
 * - debug_mode is true
 * - An error occurred
 * - 1% random sampling (for production observability)
 */
function should_log_tier2(trace, options) {
    var _a;
    // Always log if debug_mode is on
    if (trace.debug_mode) {
        return true;
    }
    // Always log if there was an error
    if (options === null || options === void 0 ? void 0 : options.has_error) {
        return true;
    }
    // Force sample if requested
    if (options === null || options === void 0 ? void 0 : options.force_sample) {
        return true;
    }
    // Random sampling (default 1%)
    const sample_rate = (_a = options === null || options === void 0 ? void 0 : options.sample_rate) !== null && _a !== void 0 ? _a : 0.01;
    return Math.random() < sample_rate;
}
/**
 * Extracts trace context from an incoming request.
 * Used by Entry layer to continue an existing trace or start a new one.
 *
 * @param request_data - The incoming request data
 * @param default_debug_mode - Default debug mode if not specified
 */
function extract_trace_from_request(request_data, default_debug_mode = false) {
    var _a, _b;
    // If request provides a trace_id, continue that trace
    if (request_data === null || request_data === void 0 ? void 0 : request_data.trace_id) {
        return {
            trace_id: request_data.trace_id,
            span_id: generate_id(),
            debug_mode: (_a = request_data.debug_mode) !== null && _a !== void 0 ? _a : default_debug_mode,
        };
    }
    // Otherwise, start a new trace
    return create_trace_context((_b = request_data === null || request_data === void 0 ? void 0 : request_data.debug_mode) !== null && _b !== void 0 ? _b : default_debug_mode);
}
/**
 * Creates a trace context for a Firestore trigger event.
 * Uses the event ID for deterministic idempotency tracking.
 *
 * @param document_id - The document that triggered the event
 * @param event_id - Firebase's event ID (unique per trigger invocation)
 */
function create_trigger_trace(document_id, event_id) {
    const trace = create_trace_context();
    return Object.assign(Object.assign({}, trace), { 
        // Deterministic key for trigger idempotency
        idempotency_key: `trigger:${document_id}:${event_id}` });
}
//# sourceMappingURL=tracer.js.map