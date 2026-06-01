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

import { getFirestore, Timestamp } from "firebase-admin/firestore";

/**
 * Collection for circuit breaker state.
 */
const COLLECTION = "_circuit_breaker_state";

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
 * Stored circuit breaker state.
 */
interface CircuitBreakerDoc {
  /** Current state */
  status: CircuitState;

  /** Consecutive failure count */
  failure_count: number;

  /** Consecutive success count (in half-open) */
  success_count: number;

  /** Timestamp of last failure */
  last_failure: Timestamp | null;

  /** Timestamp of last state change */
  state_changed_at: Timestamp;

  /** Configuration */
  config: {
    failure_threshold: number;
    reset_timeout_ms: number;
    success_threshold: number;
  };
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: Required<CircuitBreakerConfig> = {
  failure_threshold: 5,
  reset_timeout_ms: 30000, // 30 seconds
  success_threshold: 2,
};

/**
 * Gets the current state of a circuit breaker.
 *
 * @param service_name - Name of the service
 * @returns Current circuit state
 */
export async function get_circuit_state(service_name: string): Promise<{
  state: CircuitState;
  failure_count: number;
  can_attempt: boolean;
}> {
  const db = getFirestore();
  const doc = await db.collection(COLLECTION).doc(service_name).get();

  if (!doc.exists) {
    return { state: "closed", failure_count: 0, can_attempt: true };
  }

  const data = doc.data() as CircuitBreakerDoc;

  // Check if open circuit should transition to half-open
  if (data.status === "open") {
    const elapsed = Date.now() - data.state_changed_at.toMillis();
    if (elapsed >= data.config.reset_timeout_ms) {
      return { state: "half-open", failure_count: data.failure_count, can_attempt: true };
    }
    return { state: "open", failure_count: data.failure_count, can_attempt: false };
  }

  return {
    state: data.status,
    failure_count: data.failure_count,
    can_attempt: true,
  };
}

/**
 * Records a successful call to a service.
 * In half-open state, may close the circuit.
 *
 * @param service_name - Name of the service
 * @param config - Circuit breaker configuration
 */
export async function record_success(
  service_name: string,
  config?: CircuitBreakerConfig
): Promise<void> {
  const db = getFirestore();
  const doc_ref = db.collection(COLLECTION).doc(service_name);
  const merged_config = { ...DEFAULT_CONFIG, ...config };

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(doc_ref);

    if (!doc.exists) {
      // No state to update
      return;
    }

    const data = doc.data() as CircuitBreakerDoc;

    if (data.status === "closed") {
      // Just reset failure count
      transaction.update(doc_ref, {
        failure_count: 0,
      });
      return;
    }

    if (data.status === "half-open") {
      const new_success_count = data.success_count + 1;

      if (new_success_count >= merged_config.success_threshold) {
        // Close the circuit
        transaction.update(doc_ref, {
          status: "closed",
          failure_count: 0,
          success_count: 0,
          state_changed_at: Timestamp.now(),
        });
      } else {
        transaction.update(doc_ref, {
          success_count: new_success_count,
        });
      }
    }
  });
}

/**
 * Records a failed call to a service.
 * May open the circuit if threshold is reached.
 *
 * @param service_name - Name of the service
 * @param config - Circuit breaker configuration
 */
export async function record_failure(
  service_name: string,
  config?: CircuitBreakerConfig
): Promise<void> {
  const db = getFirestore();
  const doc_ref = db.collection(COLLECTION).doc(service_name);
  const merged_config = { ...DEFAULT_CONFIG, ...config };
  const now = Timestamp.now();

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(doc_ref);

    if (!doc.exists) {
      // Create new state
      const initial: CircuitBreakerDoc = {
        status: "closed",
        failure_count: 1,
        success_count: 0,
        last_failure: now,
        state_changed_at: now,
        config: merged_config,
      };
      transaction.set(doc_ref, initial);
      return;
    }

    const data = doc.data() as CircuitBreakerDoc;
    const new_failure_count = data.failure_count + 1;

    if (data.status === "half-open") {
      // Any failure in half-open opens the circuit
      transaction.update(doc_ref, {
        status: "open",
        failure_count: new_failure_count,
        success_count: 0,
        last_failure: now,
        state_changed_at: now,
      });
      return;
    }

    if (new_failure_count >= merged_config.failure_threshold) {
      // Open the circuit
      transaction.update(doc_ref, {
        status: "open",
        failure_count: new_failure_count,
        last_failure: now,
        state_changed_at: now,
      });
    } else {
      // Just increment failure count
      transaction.update(doc_ref, {
        failure_count: new_failure_count,
        last_failure: now,
      });
    }
  });
}

/**
 * Resets a circuit breaker to closed state.
 * Use with caution - typically for administrative purposes.
 *
 * @param service_name - Name of the service
 */
export async function reset_circuit(service_name: string): Promise<void> {
  const db = getFirestore();
  await db.collection(COLLECTION).doc(service_name).update({
    status: "closed",
    failure_count: 0,
    success_count: 0,
    state_changed_at: Timestamp.now(),
  });
}

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
export async function with_circuit_breaker<T>(
  service_name: string,
  fn: () => Promise<T>,
  config?: CircuitBreakerConfig
): Promise<T> {
  const state = await get_circuit_state(service_name);

  if (!state.can_attempt) {
    throw new Error(`Circuit open for service: ${service_name}`);
  }

  try {
    const result = await fn();
    await record_success(service_name, config);
    return result;
  } catch (error) {
    await record_failure(service_name, config);
    throw error;
  }
}
