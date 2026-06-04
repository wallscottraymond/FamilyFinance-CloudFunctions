/**
 * Rate Limiter
 *
 * Provides rate limiting using a sliding window algorithm.
 * Prevents abuse and ensures fair resource usage.
 *
 * Note: Background jobs are exempt from rate limiting.
 *
 * @module infrastructure/rate_limiter
 */
/**
 * Rate limit configuration.
 */
export interface RateLimitConfig {
    /** Maximum requests allowed in the window */
    max_requests: number;
    /** Window duration in milliseconds */
    window_ms: number;
}
/**
 * Rate limit check result.
 */
export interface RateLimitResult {
    /** Whether the request is allowed */
    allowed: boolean;
    /** Current request count in the window */
    current_count: number;
    /** Maximum allowed requests */
    max_requests: number;
    /** Time until the window resets (ms) */
    reset_in_ms: number;
    /** Retry after this many ms if rate limited */
    retry_after_ms?: number;
}
/**
 * Default rate limits for different contexts.
 */
export declare const DEFAULT_LIMITS: {
    /** Per-user API call limit */
    readonly USER_API: {
        readonly max_requests: 100;
        readonly window_ms: 60000;
    };
    /** Per-user write operation limit */
    readonly USER_WRITES: {
        readonly max_requests: 50;
        readonly window_ms: 60000;
    };
    /** Global Plaid API limit (to stay within Plaid's limits) */
    readonly PLAID_API: {
        readonly max_requests: 30;
        readonly window_ms: 60000;
    };
    /** Per-IP unauthenticated limit */
    readonly IP_UNAUTH: {
        readonly max_requests: 20;
        readonly window_ms: 60000;
    };
};
/**
 * Checks if a request is allowed under the rate limit.
 *
 * @param key - Unique key for rate limiting (e.g., "user:abc123:api")
 * @param config - Rate limit configuration
 * @returns Rate limit result
 *
 * @example
 * const result = await check_rate_limit(
 *   `user:${user_id}:api`,
 *   DEFAULT_LIMITS.USER_API
 * );
 * if (!result.allowed) {
 *   throw new HttpsError('resource-exhausted', 'Rate limited');
 * }
 */
export declare function check_rate_limit(key: string, config: RateLimitConfig): Promise<RateLimitResult>;
/**
 * Records a request for rate limiting.
 * Call this after check_rate_limit returns allowed: true.
 *
 * @param key - Unique key for rate limiting
 * @param config - Rate limit configuration
 */
export declare function record_request(key: string, config: RateLimitConfig): Promise<void>;
/**
 * Checks and records a request in a single operation.
 * More efficient than separate check + record calls.
 *
 * @param key - Unique key for rate limiting
 * @param config - Rate limit configuration
 * @returns Rate limit result (request is recorded if allowed)
 */
export declare function check_and_record(key: string, config: RateLimitConfig): Promise<RateLimitResult>;
/**
 * Cleans up expired rate limit records.
 * Should be called by a scheduled job.
 *
 * @param older_than_ms - Delete records not updated in this many ms
 * @returns Number of records deleted
 */
export declare function cleanup_rate_limits(older_than_ms?: number): Promise<number>;
/**
 * Builds a rate limit key for a user.
 *
 * @param user_id - User ID
 * @param action - Action type (e.g., "api", "writes")
 */
export declare function user_rate_key(user_id: string, action: string): string;
/**
 * Builds a rate limit key for an IP address.
 *
 * @param ip - IP address
 * @param action - Action type
 */
export declare function ip_rate_key(ip: string, action: string): string;
/**
 * Builds a rate limit key for a global resource.
 *
 * @param resource - Resource name (e.g., "plaid")
 */
export declare function global_rate_key(resource: string): string;
//# sourceMappingURL=rate_limiter.d.ts.map