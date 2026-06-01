/**
 * Infrastructure Repository Module
 *
 * Repository layer for infrastructure/internal operations.
 *
 * @module repository/infrastructure
 */

// Idempotency
export {
  IdempotencyRecord,
  delete_expired_records as delete_expired_idempotency_records,
  get_active_count as get_active_idempotency_count,
  get_record as get_idempotency_record,
  upsert_record as upsert_idempotency_record,
  update_record as update_idempotency_record,
  delete_record as delete_idempotency_record,
  claim_key as claim_idempotency_key,
} from "./idempotency.repository";

// Logs
export {
  LOG_COLLECTIONS,
  delete_old_records as delete_old_log_records,
  get_record_count as get_log_record_count,
  write_minimal_log,
  write_debug_log,
  write_trace_summary,
} from "./logs.repository";

// Trigger processing
export {
  TriggerProcessingRecord,
  delete_old_records as delete_old_trigger_records,
  is_processed as is_trigger_processed,
  mark_processed as mark_trigger_processed,
  get_record_count as get_trigger_record_count,
} from "./trigger_processing.repository";

// Soft delete
export {
  SOFT_DELETE_COLLECTIONS,
  SoftDeleteCollection,
  purge_deleted_records,
  get_deleted_count,
  get_purgeable_count,
} from "./soft_delete.repository";

// Quota
export {
  QuotaTrackingDoc,
  QuotaSnapshotDoc,
  get_today_usage,
  increment_reads,
  increment_writes,
  save_snapshot as save_quota_snapshot,
  get_latest_snapshot as get_latest_quota_snapshot,
  delete_old_tracking as delete_old_quota_tracking,
  delete_old_snapshots as delete_old_quota_snapshots,
} from "./quota.repository";
