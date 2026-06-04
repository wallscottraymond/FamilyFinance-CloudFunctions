/**
 * Circuit Breaker
 *
 * Implements the circuit breaker pattern for external service calls.
 * Prevents cascading failures by failing fast when a service is unhealthy.
 *
 * States:
 * - closed: Normal operation, requests pass through
 * - open: Failing fast, requests rejected immediately
 * - half-open: Testing if service has recovered
 *
 * @module infrastructure/circuit_breaker
 */
/**
 * Circuit breaker configuration.
 */
export interface CircuitBreakerConfig {
    /** Number of failures before opening circuit (default: 5) */
    failure_threshold?: number;
    /** Time in ms before attempting to close circuit (default: 30000) */
    reset_timeout_ms?: number;
    /** Number of successes in half-open before closing (default: 2) */
    success_threshold?: number;
}
/**
 * Circuit breaker state.
 */
export type CircuitState = "closed" | "open" | "half-open";
/**
 * Gets the current state of a circuit breaker.
 *
 * @param service_name - Name of the service
 * @returns Current circuit state
 */
export declare function get_circuit_state(service_name: string): Promise<{
    state: CircuitState;
    failure_count: number;
    can_attempt: boolean;
}>;
/**
 * Records a successful call to a service.
 * In half-open state, may close the circuit.
 *
 * @param service_name - Name of the service
 * @param config - Circuit breaker configuration
 */
export declare function record_success(service_name: string, config?: CircuitBreakerConfig): Promise<void>;
/**
 * Records a failed call to a service.
 * May open the circuit if threshold is reached.
 *
 * @param service_name - Name of the service
 * @param config - Circuit breaker configuration
 */
export declare function record_failure(service_name: string, config?: CircuitBreakerConfig): Promise<void>;
/**
 * Resets a circuit breaker to closed state.
 * Use with caution - typically for administrative purposes.
 *
 * @param service_name - Name of the service
 */
export declare function reset_circuit(service_name: string): Promise<void>;
/**
 * Wrapper function that executes a call with circuit breaker protection.
 *
 * @param service_name - Name of the service
 * @param fn - Function to execute
 * @param config - Circuit breaker configuration
 * @returns Result of the function
 * @throws Error if circuit is open
 *
 * @example
 * const result = await with_circuit_breaker("plaid", async () => {
 *   return await plaidClient.getAccounts(access_token);
 * });
 */
export declare function with_circuit_breaker<T>(service_name: string, fn: () => Promise<T>, config?: CircuitBreakerConfig): Promise<T>;
//# sourceMappingURL=circuit_breaker.d.ts.map