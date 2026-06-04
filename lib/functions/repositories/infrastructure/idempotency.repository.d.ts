/**
 * Idempotency Repository
 *
 * Repository layer for idempotency record operations.
 * Handles all Firestore access for the _idempotency collection.
 *
 * @module repository/infrastructure/idempotency
 */
import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
/**
 * Stored idempotency record.
 */
export interface IdempotencyRecord {
    key: string;
    status: "in_progress" | "completed" | "failed";
    result?: unknown;
    error_message?: string;
    created_at: Timestamp;
    expires_at: Timestamp;
    trace_id?: string;
}
/**
 * Deletes expired idempotency records in batches.
 *
 * @param ctx - Trace context
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of deleted records
 */
export declare function delete_expired_records(ctx: TraceContext, batch_size: number): Promise<{
    deleted_count: number;
}>;
/**
 * Gets count of active (non-expired) idempotency records.
 *
 * @param ctx - Trace context
 * @returns Count of active records
 */
export declare function get_active_count(_ctx: TraceContext): Promise<number>;
/**
 * Checks if a key exists and is not expired.
 *
 * @param ctx - Trace context
 * @param key - Idempotency key
 * @returns The record if exists and not expired, null otherwise
 */
export declare function get_record(ctx: TraceContext, key: string): Promise<IdempotencyRecord | null>;
/**
 * Creates or updates an idempotency record.
 *
 * @param ctx - Trace context
 * @param key - Idempotency key
 * @param data - Record data
 */
export declare function upsert_record(ctx: TraceContext, key: string, data: Omit<IdempotencyRecord, "key">): Promise<void>;
/**
 * Updates an existing idempotency record.
 *
 * @param ctx - Trace context
 * @param key - Idempotency key
 * @param data - Partial record data to update
 */
export declare function update_record(ctx: TraceContext, key: string, data: Partial<IdempotencyRecord>): Promise<void>;
/**
 * Deletes an idempotency record.
 *
 * @param ctx - Trace context
 * @param key - Idempotency key
 */
export declare function delete_record(ctx: TraceContext, key: string): Promise<void>;
/**
 * Claims an idempotency key using a transaction.
 *
 * @param ctx - Trace context
 * @param key - Idempotency key
 * @param ttl_ms - TTL in milliseconds
 * @returns true if claimed, false if already claimed
 */
export declare function claim_key(ctx: TraceContext, key: string, ttl_ms: number): Promise<boolean>;
//# sourceMappingURL=idempotency.repository.d.ts.map