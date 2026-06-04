/**
 * Audit Trail Types
 *
 * Defines the structure for immutable audit log entries.
 * All repository writes generate audit entries for compliance and debugging.
 *
 * @module audit/types
 */
import { Timestamp } from "firebase-admin/firestore";
/**
 * Actions that can be audited.
 */
export type AuditAction = "create" | "update" | "delete" | "restore";
/**
 * Entity types that can be audited.
 */
export type AuditEntityType = "account" | "transaction" | "budget" | "period" | "recurring_outflow" | "recurring_inflow" | "outflow_period" | "inflow_period" | "plaid_item" | "user" | "user_summary" | "group";
/**
 * Immutable audit log entry.
 * Written to _audit collection (append-only, never deleted).
 */
export interface AuditEntry {
    /** Unique audit entry ID (auto-generated) */
    audit_id: string;
    /** Timestamp of the audited action */
    timestamp: Timestamp;
    /** User who performed the action */
    user_id: string;
    /** Action performed */
    action: AuditAction;
    /** Type of entity affected */
    entity_type: AuditEntityType;
    /** ID of the entity affected */
    entity_id: string;
    /** State of entity before the action (null for create) */
    before: Record<string, unknown> | null;
    /** State of entity after the action (null for delete) */
    after: Record<string, unknown> | null;
    /** Trace ID for correlation with request logs */
    trace_id: string;
    /** Hash of before state (for quick comparison) */
    before_hash: string;
    /** Hash of after state (for quick comparison) */
    after_hash: string;
    /** Fields that changed (for updates) */
    changed_fields?: string[];
    /** Optional metadata about the change */
    metadata?: {
        /** IP address of requester (if available) */
        ip_address?: string;
        /** Source of the change */
        source?: "api" | "trigger" | "scheduled" | "migration";
        /** Additional context */
        context?: Record<string, unknown>;
    };
}
/**
 * Input for creating an audit entry.
 * The audit_id and timestamp are auto-generated.
 */
export interface AuditEntryInput {
    user_id: string;
    action: AuditAction;
    entity_type: AuditEntityType;
    entity_id: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    trace_id: string;
    metadata?: AuditEntry["metadata"];
}
/**
 * Query options for reading audit entries.
 */
export interface AuditQueryOptions {
    /** Filter by entity type */
    entity_type?: AuditEntityType;
    /** Filter by entity ID */
    entity_id?: string;
    /** Filter by user ID */
    user_id?: string;
    /** Filter by action */
    action?: AuditAction;
    /** Start timestamp (inclusive) */
    start_time?: Timestamp;
    /** End timestamp (inclusive) */
    end_time?: Timestamp;
    /** Maximum entries to return (default: 100) */
    limit?: number;
    /** Order direction (default: desc - most recent first) */
    order?: "asc" | "desc";
}
/**
 * Result of an audit query.
 */
export interface AuditQueryResult {
    /** Matching audit entries */
    entries: AuditEntry[];
    /** Total count (may exceed entries.length if limited) */
    total_count?: number;
    /** Whether more entries exist beyond the limit */
    has_more: boolean;
}
//# sourceMappingURL=audit.types.d.ts.map