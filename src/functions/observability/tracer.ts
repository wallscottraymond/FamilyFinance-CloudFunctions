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
export function generate_id(): string {
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
export function create_trace_context(debug_mode = false): TraceContext {
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
export function create_child_span(parent: TraceContext): TraceContext {
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
export function create_span(
  trace: TraceContext,
  layer: string,
  function_name: string
): SpanContext {
  return {
    ...trace,
    layer,
    function: function_name,
    started_at: Date.now(),
  };
}

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
export function get_span_duration(span: SpanContext): number {
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
export function should_log_tier2(
  trace: TraceContext,
  options?: {
    has_error?: boolean;
    force_sample?: boolean;
    sample_rate?: number;
  }
): boolean {
  // Always log if debug_mode is on
  if (trace.debug_mode) {
    return true;
  }

  // Always log if there was an error
  if (options?.has_error) {
    return true;
  }

  // Force sample if requested
  if (options?.force_sample) {
    return true;
  }

  // Random sampling (default 1%)
  const sample_rate = options?.sample_rate ?? 0.01;
  return Math.random() < sample_rate;
}

/**
 * Extracts trace context from an incoming request.
 * Used by Entry layer to continue an existing trace or start a new one.
 *
 * @param request_data - The incoming request data
 * @param default_debug_mode - Default debug mode if not specified
 */
export function extract_trace_from_request(
  request_data: {
    trace_id?: string;
    debug_mode?: boolean;
  } | undefined,
  default_debug_mode = false
): TraceContext {
  // If request provides a trace_id, continue that trace
  if (request_data?.trace_id) {
    return {
      trace_id: request_data.trace_id,
      span_id: generate_id(),
      debug_mode: request_data.debug_mode ?? default_debug_mode,
    };
  }

  // Otherwise, start a new trace
  return create_trace_context(request_data?.debug_mode ?? default_debug_mode);
}

/**
 * Creates a trace context for a Firestore trigger event.
 * Uses the event ID for deterministic idempotency tracking.
 *
 * @param document_id - The document that triggered the event
 * @param event_id - Firebase's event ID (unique per trigger invocation)
 */
export function create_trigger_trace(
  document_id: string,
  event_id: string
): TraceContext & { idempotency_key: string } {
  const trace = create_trace_context();
  return {
    ...trace,
    // Deterministic key for trigger idempotency
    idempotency_key: `trigger:${document_id}:${event_id}`,
  };
}
