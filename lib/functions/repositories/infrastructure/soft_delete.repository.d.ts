/**
 * Soft Delete Repository
 *
 * Repository layer for purging soft-deleted records across collections.
 * Handles permanent deletion of records marked as isDeleted=true.
 *
 * @module repository/infrastructure/soft_delete
 */
import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
/**
 * Collections that support soft delete.
 */
export declare const SOFT_DELETE_COLLECTIONS: readonly ["budgets", "budget_periods", "transactions", "plaidItems", "plaidAccounts", "recurringOutflows", "recurringInflows"];
export type SoftDeleteCollection = typeof SOFT_DELETE_COLLECTIONS[number];
/**
 * Purges soft-deleted records from a collection.
 *
 * @param ctx - Trace context
 * @param collection - Collection name
 * @param cutoff - Delete records soft-deleted before this timestamp
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of purged records
 */
export declare function purge_deleted_records(ctx: TraceContext, collection: string, cutoff: Timestamp, batch_size: number): Promise<{
    purged_count: number;
}>;
/**
 * Gets count of soft-deleted records in a collection.
 *
 * @param ctx - Trace context
 * @param collection - Collection name
 * @returns Count of soft-deleted records
 */
export declare function get_deleted_count(ctx: TraceContext, collection: string): Promise<number>;
/**
 * Gets count of soft-deleted records older than cutoff.
 *
 * @param ctx - Trace context
 * @param collection - Collection name
 * @param cutoff - Count records soft-deleted before this timestamp
 * @returns Count of purgeable records
 */
export declare function get_purgeable_count(ctx: TraceContext, collection: string, cutoff: Timestamp): Promise<number>;
//# sourceMappingURL=soft_delete.repository.d.ts.map