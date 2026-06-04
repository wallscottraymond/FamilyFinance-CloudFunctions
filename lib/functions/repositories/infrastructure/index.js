"use strict";
/**
 * Infrastructure Repository Module
 *
 * Repository layer for infrastructure/internal operations.
 *
 * @module repository/infrastructure
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.delete_old_quota_snapshots = exports.delete_old_quota_tracking = exports.get_latest_quota_snapshot = exports.save_quota_snapshot = exports.increment_writes = exports.increment_reads = exports.get_today_usage = exports.get_purgeable_count = exports.get_deleted_count = exports.purge_deleted_records = exports.SOFT_DELETE_COLLECTIONS = exports.get_trigger_record_count = exports.mark_trigger_processed = exports.is_trigger_processed = exports.delete_old_trigger_records = exports.write_trace_summary = exports.write_debug_log = exports.write_minimal_log = exports.get_log_record_count = exports.delete_old_log_records = exports.LOG_COLLECTIONS = exports.claim_idempotency_key = exports.delete_idempotency_record = exports.update_idempotency_record = exports.upsert_idempotency_record = exports.get_idempotency_record = exports.get_active_idempotency_count = exports.delete_expired_idempotency_records = void 0;
// Idempotency
var idempotency_repository_1 = require("./idempotency.repository");
Object.defineProperty(exports, "delete_expired_idempotency_records", { enumerable: true, get: function () { return idempotency_repository_1.delete_expired_records; } });
Object.defineProperty(exports, "get_active_idempotency_count", { enumerable: true, get: function () { return idempotency_repository_1.get_active_count; } });
Object.defineProperty(exports, "get_idempotency_record", { enumerable: true, get: function () { return idempotency_repository_1.get_record; } });
Object.defineProperty(exports, "upsert_idempotency_record", { enumerable: true, get: function () { return idempotency_repository_1.upsert_record; } });
Object.defineProperty(exports, "update_idempotency_record", { enumerable: true, get: function () { return idempotency_repository_1.update_record; } });
Object.defineProperty(exports, "delete_idempotency_record", { enumerable: true, get: function () { return idempotency_repository_1.delete_record; } });
Object.defineProperty(exports, "claim_idempotency_key", { enumerable: true, get: function () { return idempotency_repository_1.claim_key; } });
// Logs
var logs_repository_1 = require("./logs.repository");
Object.defineProperty(exports, "LOG_COLLECTIONS", { enumerable: true, get: function () { return logs_repository_1.LOG_COLLECTIONS; } });
Object.defineProperty(exports, "delete_old_log_records", { enumerable: true, get: function () { return logs_repository_1.delete_old_records; } });
Object.defineProperty(exports, "get_log_record_count", { enumerable: true, get: function () { return logs_repository_1.get_record_count; } });
Object.defineProperty(exports, "write_minimal_log", { enumerable: true, get: function () { return logs_repository_1.write_minimal_log; } });
Object.defineProperty(exports, "write_debug_log", { enumerable: true, get: function () { return logs_repository_1.write_debug_log; } });
Object.defineProperty(exports, "write_trace_summary", { enumerable: true, get: function () { return logs_repository_1.write_trace_summary; } });
// Trigger processing
var trigger_processing_repository_1 = require("./trigger_processing.repository");
Object.defineProperty(exports, "delete_old_trigger_records", { enumerable: true, get: function () { return trigger_processing_repository_1.delete_old_records; } });
Object.defineProperty(exports, "is_trigger_processed", { enumerable: true, get: function () { return trigger_processing_repository_1.is_processed; } });
Object.defineProperty(exports, "mark_trigger_processed", { enumerable: true, get: function () { return trigger_processing_repository_1.mark_processed; } });
Object.defineProperty(exports, "get_trigger_record_count", { enumerable: true, get: function () { return trigger_processing_repository_1.get_record_count; } });
// Soft delete
var soft_delete_repository_1 = require("./soft_delete.repository");
Object.defineProperty(exports, "SOFT_DELETE_COLLECTIONS", { enumerable: true, get: function () { return soft_delete_repository_1.SOFT_DELETE_COLLECTIONS; } });
Object.defineProperty(exports, "purge_deleted_records", { enumerable: true, get: function () { return soft_delete_repository_1.purge_deleted_records; } });
Object.defineProperty(exports, "get_deleted_count", { enumerable: true, get: function () { return soft_delete_repository_1.get_deleted_count; } });
Object.defineProperty(exports, "get_purgeable_count", { enumerable: true, get: function () { return soft_delete_repository_1.get_purgeable_count; } });
// Quota
var quota_repository_1 = require("./quota.repository");
Object.defineProperty(exports, "get_today_usage", { enumerable: true, get: function () { return quota_repository_1.get_today_usage; } });
Object.defineProperty(exports, "increment_reads", { enumerable: true, get: function () { return quota_repository_1.increment_reads; } });
Object.defineProperty(exports, "increment_writes", { enumerable: true, get: function () { return quota_repository_1.increment_writes; } });
Object.defineProperty(exports, "save_quota_snapshot", { enumerable: true, get: function () { return quota_repository_1.save_snapshot; } });
Object.defineProperty(exports, "get_latest_quota_snapshot", { enumerable: true, get: function () { return quota_repository_1.get_latest_snapshot; } });
Object.defineProperty(exports, "delete_old_quota_tracking", { enumerable: true, get: function () { return quota_repository_1.delete_old_tracking; } });
Object.defineProperty(exports, "delete_old_quota_snapshots", { enumerable: true, get: function () { return quota_repository_1.delete_old_snapshots; } });
//# sourceMappingURL=index.js.map