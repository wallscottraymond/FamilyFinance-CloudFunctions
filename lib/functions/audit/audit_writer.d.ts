/**
 * Audit Trail Writer
 *
 * Provides append-only audit logging for all repository writes.
 * Audit entries are NEVER deleted - they form an immutable record.
 *
 * @module audit/writer
 */
import { AuditEntry, AuditEntryInput, AuditQueryOptions, AuditQueryResult } from "./audit.types";
/**
 * Records an audit entry synchronously.
 * Use this when you need to ensure the audit is written before proceeding.
 *
 * @param input - Audit entry input
 * @returns The created audit entry
 */
export declare function record_audit_entry(input: AuditEntryInput): Promise<AuditEntry>;
/**
 * Records an audit entry asynchronously (fire-and-forget).
 * Use this for non-critical audit logging that shouldn't block the main flow.
 *
 * @param input - Audit entry input
 */
export declare function record_audit_entry_async(input: AuditEntryInput): void;
/**
 * Records multiple audit entries in a batch.
 * Use this when multiple entities are affected by a single operation.
 *
 * @param inputs - Array of audit entry inputs
 * @returns Array of created audit entries
 */
export declare function record_audit_entries_batch(inputs: AuditEntryInput[]): Promise<AuditEntry[]>;
/**
 * Queries audit entries with filtering options.
 * For support and debugging purposes.
 *
 * @param options - Query options
 * @returns Matching audit entries
 */
export declare function query_audit_entries(options: AuditQueryOptions): Promise<AuditQueryResult>;
/**
 * Gets the full audit history for a specific entity.
 * Returns all changes from creation to current state.
 *
 * @param entity_type - Type of entity
 * @param entity_id - Entity ID
 * @returns All audit entries for the entity, oldest first
 */
export declare function get_entity_audit_history(entity_type: AuditEntryInput["entity_type"], entity_id: string): Promise<AuditEntry[]>;
/**
 * Gets the most recent audit entry for an entity.
 * Useful for quick change detection.
 *
 * @param entity_type - Type of entity
 * @param entity_id - Entity ID
 * @returns Most recent audit entry or null
 */
export declare function get_latest_audit_entry(entity_type: AuditEntryInput["entity_type"], entity_id: string): Promise<AuditEntry | null>;
/**
 * Checks if an entity has any audit history.
 * Quick existence check without fetching full data.
 *
 * @param entity_type - Type of entity
 * @param entity_id - Entity ID
 * @returns Whether audit history exists
 */
export declare function has_audit_history(entity_type: AuditEntryInput["entity_type"], entity_id: string): Promise<boolean>;
//# sourceMappingURL=audit_writer.d.ts.map