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
export class TimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeout_ms: number,
    public readonly operation?: string
  ) {
    super(message);
    this.name = "TimeoutError";
  }
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
export async function with_timeout<T>(
  promise: Promise<T>,
  timeout_ms: number,
  operation?: string
): Promise<T> {
  let timeout_id: NodeJS.Timeout;

  const timeout_promise = new Promise<never>((_, reject) => {
    timeout_id = setTimeout(() => {
      const op_name = operation ?? "Operation";
      reject(new TimeoutError(`${op_name} timed out after ${timeout_ms}ms`, timeout_ms, operation));
    }, timeout_ms);
  });

  try {
    const result = await Promise.race([promise, timeout_promise]);
    clearTimeout(timeout_id!);
    return result;
  } catch (error) {
    clearTimeout(timeout_id!);
    throw error;
  }
}

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
export function create_deferred<T>(): DeferredPromise<T> {
  let resolve_fn: (value: T) => void;
  let reject_fn: (error: Error) => void;

  const promise = new Promise<T>((resolve, reject) => {
    resolve_fn = resolve;
    reject_fn = reject;
  });

  return {
    promise,
    resolve: resolve_fn!,
    reject: reject_fn!,
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
export async function with_retry<T>(
  fn: () => Promise<T>,
  options: {
    timeout_ms: number;
    retries?: number;
    backoff_ms?: number;
    should_retry?: (error: Error) => boolean;
    operation?: string;
  }
): Promise<T> {
  const retries = options.retries ?? 3;
  const backoff_ms = options.backoff_ms ?? 1000;
  const should_retry = options.should_retry ?? ((): boolean => true);

  let last_error: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await with_timeout(fn(), options.timeout_ms, options.operation);
    } catch (error) {
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
export function sleep(ms: number): Promise<void> {
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
export function create_deadline(timeout_ms: number): {
  remaining: () => number;
  is_expired: () => boolean;
  expires_at: number;
} {
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
export const DEFAULT_TIMEOUTS = {
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
} as const;
