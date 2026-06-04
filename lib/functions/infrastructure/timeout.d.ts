/**
 * Timeout Utilities
 *
 * Provides timeout wrappers for async operations.
 * Helps enforce time budgets and prevent hanging operations.
 *
 * @module infrastructure/timeout
 */
/**
 * Error thrown when an operation times out.
 */
export declare class TimeoutError extends Error {
    readonly timeout_ms: number;
    readonly operation?: string | undefined;
    constructor(message: string, timeout_ms: number, operation?: string | undefined);
}
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
export declare function with_timeout<T>(promise: Promise<T>, timeout_ms: number, operation?: string): Promise<T>;
/**
 * Creates a deferred promise that can be resolved/rejected externally.
 * Useful for implementing custom timeout logic.
 */
export interface DeferredPromise<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
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
export declare function create_deferred<T>(): DeferredPromise<T>;
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
export declare function with_retry<T>(fn: () => Promise<T>, options: {
    timeout_ms: number;
    retries?: number;
    backoff_ms?: number;
    should_retry?: (error: Error) => boolean;
    operation?: string;
}): Promise<T>;
/**
 * Sleeps for the specified duration.
 *
 * @param ms - Duration in milliseconds
 */
export declare function sleep(ms: number): Promise<void>;
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
export declare function create_deadline(timeout_ms: number): {
    remaining: () => number;
    is_expired: () => boolean;
    expires_at: number;
};
/**
 * Default timeouts for different operation types.
 */
export declare const DEFAULT_TIMEOUTS: {
    /** Quick Firestore read */
    readonly FIRESTORE_READ: 5000;
    /** Firestore write/transaction */
    readonly FIRESTORE_WRITE: 10000;
    /** External API call */
    readonly EXTERNAL_API: 15000;
    /** Plaid API call (can be slow) */
    readonly PLAID_API: 30000;
    /** Background job */
    readonly BACKGROUND_JOB: 60000;
    /** Total function execution (leave buffer for cleanup) */
    readonly FUNCTION_TOTAL: 55000;
};
//# sourceMappingURL=timeout.d.ts.map