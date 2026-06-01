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
export function compute_hash(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return "null";
  }

  const str = JSON.stringify(obj);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Creates a WriteResult for a write operation.
 */
export function create_write_result(
  entity_type: string,
  entity_id: string,
  operation: WriteMode,
  before: unknown,
  after: unknown
): WriteResult {
  return {
    entity_type,
    entity_id,
    operation,
    before_hash: compute_hash(before),
    after_hash: compute_hash(after),
  };
}

/**
 * Maximum documents per Firestore batch write.
 * Must split larger batches to respect this limit.
 */
export const FIRESTORE_BATCH_LIMIT = 500;

/**
 * Splits an array into chunks for batch processing.
 */
export function chunk_for_batch<T>(items: T[], size = FIRESTORE_BATCH_LIMIT): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
