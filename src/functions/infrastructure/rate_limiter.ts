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

import { getFirestore, Timestamp } from "firebase-admin/firestore";

/**
 * Collection for rate limit tracking.
 */
const COLLECTION = "_rate_limits";

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
 * Stored rate limit record.
 */
interface RateLimitDoc {
  /** Request timestamps in the current window */
  timestamps: Timestamp[];

  /** When to clean up old entries */
  window_start: Timestamp;

  /** Configuration used */
  config: {
    max_requests: number;
    window_ms: number;
  };
}

/**
 * Default rate limits for different contexts.
 */
export const DEFAULT_LIMITS = {
  /** Per-user API call limit */
  USER_API: { max_requests: 100, window_ms: 60000 }, // 100/min

  /** Per-user write operation limit */
  USER_WRITES: { max_requests: 50, window_ms: 60000 }, // 50/min

  /** Global Plaid API limit (to stay within Plaid's limits) */
  PLAID_API: { max_requests: 30, window_ms: 60000 }, // 30/min

  /** Per-IP unauthenticated limit */
  IP_UNAUTH: { max_requests: 20, window_ms: 60000 }, // 20/min
} as const;

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
export async function check_rate_limit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const db = getFirestore();
  const doc_ref = db.collection(COLLECTION).doc(key);
  const now = Date.now();
  const window_start = now - config.window_ms;

  const doc = await doc_ref.get();

  if (!doc.exists) {
    return {
      allowed: true,
      current_count: 0,
      max_requests: config.max_requests,
      reset_in_ms: config.window_ms,
    };
  }

  const data = doc.data() as RateLimitDoc;

  // Filter to only timestamps within the current window
  const valid_timestamps = data.timestamps.filter(
    (ts) => ts.toMillis() > window_start
  );

  const current_count = valid_timestamps.length;

  if (current_count >= config.max_requests) {
    // Find when the oldest request in the window will expire
    const oldest = Math.min(...valid_timestamps.map((ts) => ts.toMillis()));
    const retry_after_ms = oldest + config.window_ms - now;

    return {
      allowed: false,
      current_count,
      max_requests: config.max_requests,
      reset_in_ms: retry_after_ms,
      retry_after_ms: Math.max(0, retry_after_ms),
    };
  }

  return {
    allowed: true,
    current_count,
    max_requests: config.max_requests,
    reset_in_ms: config.window_ms,
  };
}

/**
 * Records a request for rate limiting.
 * Call this after check_rate_limit returns allowed: true.
 *
 * @param key - Unique key for rate limiting
 * @param config - Rate limit configuration
 */
export async function record_request(
  key: string,
  config: RateLimitConfig
): Promise<void> {
  const db = getFirestore();
  const doc_ref = db.collection(COLLECTION).doc(key);
  const now = Timestamp.now();

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(doc_ref);

    if (!doc.exists) {
      const new_doc: RateLimitDoc = {
        timestamps: [now],
        window_start: now,
        config,
      };
      transaction.set(doc_ref, new_doc);
      return;
    }

    const data = doc.data() as RateLimitDoc;
    const window_start = Date.now() - config.window_ms;

    // Filter out expired timestamps and add the new one
    const valid_timestamps = data.timestamps.filter(
      (ts) => ts.toMillis() > window_start
    );
    valid_timestamps.push(now);

    transaction.update(doc_ref, {
      timestamps: valid_timestamps,
    });
  });
}

/**
 * Checks and records a request in a single operation.
 * More efficient than separate check + record calls.
 *
 * @param key - Unique key for rate limiting
 * @param config - Rate limit configuration
 * @returns Rate limit result (request is recorded if allowed)
 */
export async function check_and_record(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const db = getFirestore();
  const doc_ref = db.collection(COLLECTION).doc(key);
  const now = Timestamp.now();
  const now_ms = now.toMillis();
  const window_start_ms = now_ms - config.window_ms;

  const result = await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(doc_ref);

    let valid_timestamps: Timestamp[] = [];

    if (doc.exists) {
      const data = doc.data() as RateLimitDoc;
      valid_timestamps = data.timestamps.filter(
        (ts) => ts.toMillis() > window_start_ms
      );
    }

    const current_count = valid_timestamps.length;

    if (current_count >= config.max_requests) {
      // Rate limited - don't record, just return result
      const oldest = Math.min(...valid_timestamps.map((ts) => ts.toMillis()));
      const retry_after_ms = oldest + config.window_ms - now_ms;

      return {
        allowed: false,
        current_count,
        max_requests: config.max_requests,
        reset_in_ms: retry_after_ms,
        retry_after_ms: Math.max(0, retry_after_ms),
      };
    }

    // Allowed - record the request
    valid_timestamps.push(now);

    if (doc.exists) {
      transaction.update(doc_ref, { timestamps: valid_timestamps });
    } else {
      const new_doc: RateLimitDoc = {
        timestamps: valid_timestamps,
        window_start: now,
        config,
      };
      transaction.set(doc_ref, new_doc);
    }

    return {
      allowed: true,
      current_count: current_count + 1,
      max_requests: config.max_requests,
      reset_in_ms: config.window_ms,
    };
  });

  return result;
}

/**
 * Cleans up expired rate limit records.
 * Should be called by a scheduled job.
 *
 * @param older_than_ms - Delete records not updated in this many ms
 * @returns Number of records deleted
 */
export async function cleanup_rate_limits(
  older_than_ms: number = 24 * 60 * 60 * 1000 // 24 hours
): Promise<number> {
  const db = getFirestore();
  const cutoff = Timestamp.fromMillis(Date.now() - older_than_ms);

  const old_docs = await db
    .collection(COLLECTION)
    .where("window_start", "<", cutoff)
    .limit(500)
    .get();

  if (old_docs.empty) {
    return 0;
  }

  const batch = db.batch();
  old_docs.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();
  return old_docs.size;
}

/**
 * Builds a rate limit key for a user.
 *
 * @param user_id - User ID
 * @param action - Action type (e.g., "api", "writes")
 */
export function user_rate_key(user_id: string, action: string): string {
  return `user:${user_id}:${action}`;
}

/**
 * Builds a rate limit key for an IP address.
 *
 * @param ip - IP address
 * @param action - Action type
 */
export function ip_rate_key(ip: string, action: string): string {
  return `ip:${ip}:${action}`;
}

/**
 * Builds a rate limit key for a global resource.
 *
 * @param resource - Resource name (e.g., "plaid")
 */
export function global_rate_key(resource: string): string {
  return `global:${resource}`;
}
