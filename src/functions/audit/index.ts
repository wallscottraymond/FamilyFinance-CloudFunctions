/**
 * Audit Trail Module
 *
 * Provides immutable audit logging for all repository writes.
 * Audit entries are append-only and NEVER deleted.
 *
 * @module audit
 */

// Types
export {
  AuditAction,
  AuditEntityType,
  AuditEntry,
  AuditEntryInput,
  AuditQueryOptions,
  AuditQueryResult,
} from "./audit.types";

// Writer functions
export {
  record_audit_entry,
  record_audit_entry_async,
  record_audit_entries_batch,
  query_audit_entries,
  get_entity_audit_history,
  get_latest_audit_entry,
  has_audit_history,
} from "./audit_writer";
