"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_circuit_state = get_circuit_state;
exports.record_success = record_success;
exports.record_failure = record_failure;
exports.reset_circuit = reset_circuit;
exports.with_circuit_breaker = with_circuit_breaker;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Collection for circuit breaker state.
 */
const COLLECTION = "_circuit_breaker_state";
/**
 * Default configuration values.
 */
const DEFAULT_CONFIG = {
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
async function get_circuit_state(service_name) {
    const db = (0, firestore_1.getFirestore)();
    const doc = await db.collection(COLLECTION).doc(service_name).get();
    if (!doc.exists) {
        return { state: "closed", failure_count: 0, can_attempt: true };
    }
    const data = doc.data();
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
async function record_success(service_name, config) {
    const db = (0, firestore_1.getFirestore)();
    const doc_ref = db.collection(COLLECTION).doc(service_name);
    const merged_config = Object.assign(Object.assign({}, DEFAULT_CONFIG), config);
    await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(doc_ref);
        if (!doc.exists) {
            // No state to update
            return;
        }
        const data = doc.data();
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
                    state_changed_at: firestore_1.Timestamp.now(),
                });
            }
            else {
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
async function record_failure(service_name, config) {
    const db = (0, firestore_1.getFirestore)();
    const doc_ref = db.collection(COLLECTION).doc(service_name);
    const merged_config = Object.assign(Object.assign({}, DEFAULT_CONFIG), config);
    const now = firestore_1.Timestamp.now();
    await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(doc_ref);
        if (!doc.exists) {
            // Create new state
            const initial = {
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
        const data = doc.data();
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
        }
        else {
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
async function reset_circuit(service_name) {
    const db = (0, firestore_1.getFirestore)();
    await db.collection(COLLECTION).doc(service_name).update({
        status: "closed",
        failure_count: 0,
        success_count: 0,
        state_changed_at: firestore_1.Timestamp.now(),
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
async function with_circuit_breaker(service_name, fn, config) {
    const state = await get_circuit_state(service_name);
    if (!state.can_attempt) {
        throw new Error(`Circuit open for service: ${service_name}`);
    }
    try {
        const result = await fn();
        await record_success(service_name, config);
        return result;
    }
    catch (error) {
        await record_failure(service_name, config);
        throw error;
    }
}
//# sourceMappingURL=circuit_breaker.js.map