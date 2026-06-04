/**
 * Trace Context Creation and Propagation
 *
 * Provides trace context for observability across all layers.
 * Every operation carries a trace_id for debugging and correlation.
 *
 * @module observability/tracer
 */
import { TraceContext } from "../types";
/**
 * Generates a UUID v4 for trace and span IDs.
 */
export declare function generate_id(): string;
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
export declare function create_trace_context(debug_mode?: boolean): TraceContext;
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
export declare function create_child_span(parent: TraceContext): TraceContext;
/**
 * Creates a span context object suitable for logging.
 * Adds common metadata to the trace context.
 *
 * @param trace - The trace context
 * @param layer - The architectural layer (entry, orchestrator, resolver, domain, repository)
 * @param function_name - Name of the function being executed
 */
export declare function create_span(trace: TraceContext, layer: string, function_name: string): SpanContext;
/**
 * Extended span context with metadata for logging.
 */
export interface SpanContext extends TraceContext {
    /** Architectural layer */
    layer: string;
    /** Function name being executed */
    function: string;
    /** Timestamp when span started (ms since epoch) */
    started_at: number;
}
/**
 * Calculates span duration in milliseconds.
 */
export declare function get_span_duration(span: SpanContext): number;
/**
 * Determines if Tier 2 (detailed) logging should be enabled for this span.
 *
 * Tier 2 logging is enabled when:
 * - debug_mode is true
 * - An error occurred
 * - 1% random sampling (for production observability)
 */
export declare function should_log_tier2(trace: TraceContext, options?: {
    has_error?: boolean;
    force_sample?: boolean;
    sample_rate?: number;
}): boolean;
/**
 * Extracts trace context from an incoming request.
 * Used by Entry layer to continue an existing trace or start a new one.
 *
 * @param request_data - The incoming request data
 * @param default_debug_mode - Default debug mode if not specified
 */
export declare function extract_trace_from_request(request_data: {
    trace_id?: string;
    debug_mode?: boolean;
} | undefined, default_debug_mode?: boolean): TraceContext;
/**
 * Creates a trace context for a Firestore trigger event.
 * Uses the event ID for deterministic idempotency tracking.
 *
 * @param document_id - The document that triggered the event
 * @param event_id - Firebase's event ID (unique per trigger invocation)
 */
export declare function create_trigger_trace(document_id: string, event_id: string): TraceContext & {
    idempotency_key: string;
};
//# sourceMappingURL=tracer.d.ts.map