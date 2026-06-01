/**
 * Context Types for the Layered Architecture
 *
 * These types flow through all layers, providing traceability and configuration.
 *
 * @module types/context
 */

/**
 * Trace context that flows through all layers for observability.
 * Every function call carries this context for debugging and logging.
 */
export interface TraceContext {
  /** Global ID for entire workflow (UUID) */
  trace_id: string;

  /** ID for current function execution (UUID) */
  span_id: string;

  /** Parent span that triggered this (for nested calls) */
  causation_id?: string;

  /** Enables full Tier 2 logging when true */
  debug_mode?: boolean;
}

/**
 * Extended context for orchestrator functions.
 * Includes the input payload and user identification.
 */
export interface OrchestratorContext<TInput> extends TraceContext {
  /** The validated input payload */
  input: TInput;

  /** The authenticated user's ID */
  user_id: string;

  /** Client-provided key for idempotency */
  idempotency_key: string;
}

/**
 * Performance budget configuration for an orchestrator.
 * Used to decide when to switch to async processing.
 */
export interface PerformanceBudget {
  /** Maximum Firestore read operations */
  max_reads: number;

  /** Maximum Firestore write operations */
  max_writes: number;

  /** Maximum execution time in milliseconds */
  max_time_ms: number;
}

/**
 * Default performance budget values.
 * Individual orchestrators can override these.
 */
export const DEFAULT_PERFORMANCE_BUDGET: PerformanceBudget = {
  max_reads: 25,
  max_writes: 10,
  max_time_ms: 500,
};

/**
 * Tracks performance metrics during orchestrator execution.
 */
export interface PerformanceMetrics {
  /** Number of Firestore reads performed */
  reads: number;

  /** Number of Firestore writes performed */
  writes: number;

  /** Execution time in milliseconds */
  time_ms: number;

  /** Timestamp when tracking started */
  started_at: number;
}

/**
 * Creates a new performance metrics tracker.
 */
export function create_performance_metrics(): PerformanceMetrics {
  return {
    reads: 0,
    writes: 0,
    time_ms: 0,
    started_at: Date.now(),
  };
}

/**
 * Updates the time_ms field based on elapsed time since start.
 */
export function update_elapsed_time(metrics: PerformanceMetrics): PerformanceMetrics {
  return {
    ...metrics,
    time_ms: Date.now() - metrics.started_at,
  };
}

/**
 * Checks if the performance budget has been exceeded.
 */
export function is_budget_exceeded(
  metrics: PerformanceMetrics,
  budget: PerformanceBudget
): boolean {
  const updated = update_elapsed_time(metrics);
  return (
    updated.reads > budget.max_reads ||
    updated.writes > budget.max_writes ||
    updated.time_ms > budget.max_time_ms
  );
}
