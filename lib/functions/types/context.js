"use strict";
/**
 * Context Types for the Layered Architecture
 *
 * These types flow through all layers, providing traceability and configuration.
 *
 * @module types/context
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PERFORMANCE_BUDGET = void 0;
exports.create_performance_metrics = create_performance_metrics;
exports.update_elapsed_time = update_elapsed_time;
exports.is_budget_exceeded = is_budget_exceeded;
/**
 * Default performance budget values.
 * Individual orchestrators can override these.
 */
exports.DEFAULT_PERFORMANCE_BUDGET = {
    max_reads: 25,
    max_writes: 10,
    max_time_ms: 500,
};
/**
 * Creates a new performance metrics tracker.
 */
function create_performance_metrics() {
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
function update_elapsed_time(metrics) {
    return Object.assign(Object.assign({}, metrics), { time_ms: Date.now() - metrics.started_at });
}
/**
 * Checks if the performance budget has been exceeded.
 */
function is_budget_exceeded(metrics, budget) {
    const updated = update_elapsed_time(metrics);
    return (updated.reads > budget.max_reads ||
        updated.writes > budget.max_writes ||
        updated.time_ms > budget.max_time_ms);
}
//# sourceMappingURL=context.js.map