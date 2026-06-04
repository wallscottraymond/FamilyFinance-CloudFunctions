"use strict";
/**
 * Timeout Utilities
 *
 * Provides timeout wrappers for async operations.
 * Helps enforce time budgets and prevent hanging operations.
 *
 * @module infrastructure/timeout
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TIMEOUTS = exports.TimeoutError = void 0;
exports.with_timeout = with_timeout;
exports.create_deferred = create_deferred;
exports.with_retry = with_retry;
exports.sleep = sleep;
exports.create_deadline = create_deadline;
/**
 * Error thrown when an operation times out.
 */
class TimeoutError extends Error {
    constructor(message, timeout_ms, operation) {
        super(message);
        this.timeout_ms = timeout_ms;
        this.operation = operation;
        this.name = "TimeoutError";
    }
}
exports.TimeoutError = TimeoutError;
/**
 * Wraps a promise with a timeout.
 *
 * @param promise - The promise to wrap
 * @param timeout_ms - Timeout in milliseconds
 * @param operation - Optional operation name for error messages
 * @returns The promise result
 * @throws TimeoutError if the operation times out
 *
 * @example
 * const result = await with_timeout(
 *   fetch_external_data(),
 *   5000,
 *   "fetch_external_data"
 * );
 */
async function with_timeout(promise, timeout_ms, operation) {
    let timeout_id;
    const timeout_promise = new Promise((_, reject) => {
        timeout_id = setTimeout(() => {
            const op_name = operation !== null && operation !== void 0 ? operation : "Operation";
            reject(new TimeoutError(`${op_name} timed out after ${timeout_ms}ms`, timeout_ms, operation));
        }, timeout_ms);
    });
    try {
        const result = await Promise.race([promise, timeout_promise]);
        clearTimeout(timeout_id);
        return result;
    }
    catch (error) {
        clearTimeout(timeout_id);
        throw error;
    }
}
/**
 * Creates a deferred promise.
 *
 * @example
 * const deferred = create_deferred<string>();
 * // Later...
 * deferred.resolve("result");
 * // Or...
 * deferred.reject(new Error("failed"));
 */
function create_deferred() {
    let resolve_fn;
    let reject_fn;
    const promise = new Promise((resolve, reject) => {
        resolve_fn = resolve;
        reject_fn = reject;
    });
    return {
        promise,
        resolve: resolve_fn,
        reject: reject_fn,
    };
}
/**
 * Executes a function with a timeout and retry logic.
 *
 * @param fn - Function to execute
 * @param options - Retry and timeout options
 * @returns The function result
 *
 * @example
 * const result = await with_retry(
 *   () => call_external_api(),
 *   { timeout_ms: 5000, retries: 3, backoff_ms: 1000 }
 * );
 */
async function with_retry(fn, options) {
    var _a, _b, _c;
    const retries = (_a = options.retries) !== null && _a !== void 0 ? _a : 3;
    const backoff_ms = (_b = options.backoff_ms) !== null && _b !== void 0 ? _b : 1000;
    const should_retry = (_c = options.should_retry) !== null && _c !== void 0 ? _c : (() => true);
    let last_error;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await with_timeout(fn(), options.timeout_ms, options.operation);
        }
        catch (error) {
            last_error = error instanceof Error ? error : new Error(String(error));
            // Don't retry on the last attempt
            if (attempt === retries) {
                break;
            }
            // Check if we should retry this error
            if (!should_retry(last_error)) {
                break;
            }
            // Wait before retrying (with exponential backoff)
            const wait_time = backoff_ms * Math.pow(2, attempt);
            await sleep(wait_time);
        }
    }
    throw last_error;
}
/**
 * Sleeps for the specified duration.
 *
 * @param ms - Duration in milliseconds
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Creates a deadline from a timeout duration.
 * Useful for tracking remaining time budget.
 *
 * @param timeout_ms - Total timeout in milliseconds
 * @returns Deadline utilities
 *
 * @example
 * const deadline = create_deadline(5000);
 *
 * await with_timeout(operation1(), deadline.remaining(), "operation1");
 * await with_timeout(operation2(), deadline.remaining(), "operation2");
 *
 * if (deadline.is_expired()) {
 *   throw new TimeoutError("Deadline exceeded", 5000);
 * }
 */
function create_deadline(timeout_ms) {
    const expires_at = Date.now() + timeout_ms;
    return {
        remaining: () => Math.max(0, expires_at - Date.now()),
        is_expired: () => Date.now() >= expires_at,
        expires_at,
    };
}
/**
 * Default timeouts for different operation types.
 */
exports.DEFAULT_TIMEOUTS = {
    /** Quick Firestore read */
    FIRESTORE_READ: 5000,
    /** Firestore write/transaction */
    FIRESTORE_WRITE: 10000,
    /** External API call */
    EXTERNAL_API: 15000,
    /** Plaid API call (can be slow) */
    PLAID_API: 30000,
    /** Background job */
    BACKGROUND_JOB: 60000,
    /** Total function execution (leave buffer for cleanup) */
    FUNCTION_TOTAL: 55000, // 55s of 60s limit
};
//# sourceMappingURL=timeout.js.map