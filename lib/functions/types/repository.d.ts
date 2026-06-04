/**
 * Repository Types for Persistence Layer
 *
 * These types define the contract for all repository operations.
 * Repositories handle Firestore access and return consistent results.
 *
 * @module types/repository
 */
import { Timestamp } from "firebase-admin/firestore";
/**
 * Write operation modes for repositories.
 *
 * - replace: Full document overwrite (default, idempotent)
 * - append: Add to collection (logs, events, immutable history)
 * - merge: Partial update of specific fields only
 */
export type WriteMode = "replace" | "append" | "merge";
/**
 * Result returned by all repository write operations.
 * Used for observability and audit trail.
 */
export interface WriteResult {
    /** The type of entity written (e.g., "transaction", "budget") */
    entity_type: string;
    /** The ID of the entity written */
    entity_id: string;
    /** The type of write operation performed */
    operation: WriteMode;
    /** Hash of document state before write (for change detection) */
    before_hash: string;
    /** Hash of document state after write */
    after_hash: string;
}
/**
 * Result returned by batch write operations.
 */
export interface BatchWriteResult {
    /** Individual results for each entity in the batch */
    results: WriteResult[];
    /** Total number of entities written */
    count: number;
    /** Whether the entire batch succeeded atomically */
    success: boolean;
}
/**
 * Options for read operations.
 */
export interface ReadOptions {
    /** Include soft-deleted documents */
    include_deleted?: boolean;
    /** Maximum number of documents to return */
    limit?: number;
    /** Field to order by */
    order_by?: string;
    /** Order direction */
    order_direction?: "asc" | "desc";
}
/**
 * Common fields present on all entities.
 * All domain entities extend this interface.
 */
export interface BaseEntity {
    /** Unique identifier */
    id: string;
    /** Owner user ID */
    user_id: string;
    /** Group IDs for RBAC access control (empty = private) */
    group_ids: string[];
    /** Whether entity is active */
    is_active: boolean;
    /** Soft delete flag */
    is_deleted?: boolean;
    /** Creation timestamp */
    created_at: Timestamp;
    /** Last update timestamp */
    updated_at: Timestamp;
}
/**
 * Access control metadata for RBAC.
 * Embedded in entities for permission checking.
 */
export interface AccessMetadata {
    /** Original owner user ID */
    owner_id: string;
    /** User who created this entity */
    created_by: string;
    /** Group IDs for shared access (duplicate for validation) */
    group_ids: string[];
    /** Whether this entity is private (no group sharing) */
    is_private: boolean;
}
/**
 * Computes a simple hash of an object for change detection.
 * Used in WriteResult for before/after comparison.
 */
export declare function compute_hash(obj: unknown): string;
/**
 * Creates a WriteResult for a write operation.
 */
export declare function create_write_result(entity_type: string, entity_id: string, operation: WriteMode, before: unknown, after: unknown): WriteResult;
/**
 * Maximum documents per Firestore batch write.
 * Must split larger batches to respect this limit.
 */
export declare const FIRESTORE_BATCH_LIMIT = 500;
/**
 * Splits an array into chunks for batch processing.
 */
export declare function chunk_for_batch<T>(items: T[], size?: number): T[][];
//# sourceMappingURL=repository.d.ts.map