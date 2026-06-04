"use strict";
/**
 * Infrastructure Module
 *
 * Provides core infrastructure utilities for the layered architecture.
 *
 * @module infrastructure
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_job = exports.create_job = exports.DEFAULT_TIMEOUTS = exports.create_deadline = exports.sleep = exports.with_retry = exports.create_deferred = exports.with_timeout = exports.TimeoutError = exports.global_rate_key = exports.ip_rate_key = exports.user_rate_key = exports.cleanup_rate_limits = exports.check_and_record = exports.record_request = exports.check_rate_limit = exports.RATE_DEFAULT_LIMITS = exports.invalidate_flag_cache = exports.list_feature_flags = exports.delete_feature_flag = exports.set_feature_flag = exports.is_flag_enabled = exports.get_feature_flag = exports.load_feature_flags = exports.with_circuit_breaker = exports.reset_circuit = exports.record_failure = exports.record_success = exports.get_circuit_state = exports.check_quota_alerts = exports.get_latest_snapshot = exports.create_quota_snapshot = exports.get_current_usage = exports.track_writes = exports.track_reads = exports.QUOTA_DEFAULT_LIMITS = exports.QUOTA_THRESHOLDS = exports.get_active_count = exports.cleanup_expired_records = exports.release_key = exports.fail_key = exports.complete_key = exports.claim_key = exports.check_idempotency = exports.get_health_http_status = exports.perform_health_check = exports.check_quota_status = exports.check_queue_health = exports.check_external_service_status = exports.check_firestore_connectivity = void 0;
exports.invalidate_config_cache = exports.get_infrastructure_config = exports.DEFAULT_INFRASTRUCTURE_CONFIG = exports.claim_job = exports.cleanup_completed_jobs = exports.get_job_stats = exports.list_dlq_jobs = exports.reprocess_dlq_job = exports.move_to_dlq = exports.mark_job_failed = exports.mark_job_completed = exports.mark_job_processing = exports.get_pending_jobs = void 0;
// Health check
var health_1 = require("./health");
Object.defineProperty(exports, "check_firestore_connectivity", { enumerable: true, get: function () { return health_1.check_firestore_connectivity; } });
Object.defineProperty(exports, "check_external_service_status", { enumerable: true, get: function () { return health_1.check_external_service_status; } });
Object.defineProperty(exports, "check_queue_health", { enumerable: true, get: function () { return health_1.check_queue_health; } });
Object.defineProperty(exports, "check_quota_status", { enumerable: true, get: function () { return health_1.check_quota_status; } });
Object.defineProperty(exports, "perform_health_check", { enumerable: true, get: function () { return health_1.perform_health_check; } });
Object.defineProperty(exports, "get_health_http_status", { enumerable: true, get: function () { return health_1.get_health_http_status; } });
// Idempotency store (high-level API)
var idempotency_store_1 = require("./idempotency_store");
Object.defineProperty(exports, "check_idempotency", { enumerable: true, get: function () { return idempotency_store_1.check_idempotency; } });
Object.defineProperty(exports, "claim_key", { enumerable: true, get: function () { return idempotency_store_1.claim_key; } });
Object.defineProperty(exports, "complete_key", { enumerable: true, get: function () { return idempotency_store_1.complete_key; } });
Object.defineProperty(exports, "fail_key", { enumerable: true, get: function () { return idempotency_store_1.fail_key; } });
Object.defineProperty(exports, "release_key", { enumerable: true, get: function () { return idempotency_store_1.release_key; } });
Object.defineProperty(exports, "cleanup_expired_records", { enumerable: true, get: function () { return idempotency_store_1.cleanup_expired_records; } });
Object.defineProperty(exports, "get_active_count", { enumerable: true, get: function () { return idempotency_store_1.get_active_count; } });
// Quota monitor (high-level API)
var quota_monitor_1 = require("./quota_monitor");
Object.defineProperty(exports, "QUOTA_THRESHOLDS", { enumerable: true, get: function () { return quota_monitor_1.QUOTA_THRESHOLDS; } });
Object.defineProperty(exports, "QUOTA_DEFAULT_LIMITS", { enumerable: true, get: function () { return quota_monitor_1.DEFAULT_LIMITS; } });
Object.defineProperty(exports, "track_reads", { enumerable: true, get: function () { return quota_monitor_1.track_reads; } });
Object.defineProperty(exports, "track_writes", { enumerable: true, get: function () { return quota_monitor_1.track_writes; } });
Object.defineProperty(exports, "get_current_usage", { enumerable: true, get: function () { return quota_monitor_1.get_current_usage; } });
Object.defineProperty(exports, "create_quota_snapshot", { enumerable: true, get: function () { return quota_monitor_1.create_quota_snapshot; } });
Object.defineProperty(exports, "get_latest_snapshot", { enumerable: true, get: function () { return quota_monitor_1.get_latest_snapshot; } });
Object.defineProperty(exports, "check_quota_alerts", { enumerable: true, get: function () { return quota_monitor_1.check_quota_alerts; } });
// Circuit breaker
var circuit_breaker_1 = require("./circuit_breaker");
Object.defineProperty(exports, "get_circuit_state", { enumerable: true, get: function () { return circuit_breaker_1.get_circuit_state; } });
Object.defineProperty(exports, "record_success", { enumerable: true, get: function () { return circuit_breaker_1.record_success; } });
Object.defineProperty(exports, "record_failure", { enumerable: true, get: function () { return circuit_breaker_1.record_failure; } });
Object.defineProperty(exports, "reset_circuit", { enumerable: true, get: function () { return circuit_breaker_1.reset_circuit; } });
Object.defineProperty(exports, "with_circuit_breaker", { enumerable: true, get: function () { return circuit_breaker_1.with_circuit_breaker; } });
// Feature flags
var feature_flags_1 = require("./feature_flags");
Object.defineProperty(exports, "load_feature_flags", { enumerable: true, get: function () { return feature_flags_1.load_feature_flags; } });
Object.defineProperty(exports, "get_feature_flag", { enumerable: true, get: function () { return feature_flags_1.get_feature_flag; } });
Object.defineProperty(exports, "is_flag_enabled", { enumerable: true, get: function () { return feature_flags_1.is_flag_enabled; } });
Object.defineProperty(exports, "set_feature_flag", { enumerable: true, get: function () { return feature_flags_1.set_feature_flag; } });
Object.defineProperty(exports, "delete_feature_flag", { enumerable: true, get: function () { return feature_flags_1.delete_feature_flag; } });
Object.defineProperty(exports, "list_feature_flags", { enumerable: true, get: function () { return feature_flags_1.list_feature_flags; } });
Object.defineProperty(exports, "invalidate_flag_cache", { enumerable: true, get: function () { return feature_flags_1.invalidate_flag_cache; } });
// Rate limiter
var rate_limiter_1 = require("./rate_limiter");
Object.defineProperty(exports, "RATE_DEFAULT_LIMITS", { enumerable: true, get: function () { return rate_limiter_1.DEFAULT_LIMITS; } });
Object.defineProperty(exports, "check_rate_limit", { enumerable: true, get: function () { return rate_limiter_1.check_rate_limit; } });
Object.defineProperty(exports, "record_request", { enumerable: true, get: function () { return rate_limiter_1.record_request; } });
Object.defineProperty(exports, "check_and_record", { enumerable: true, get: function () { return rate_limiter_1.check_and_record; } });
Object.defineProperty(exports, "cleanup_rate_limits", { enumerable: true, get: function () { return rate_limiter_1.cleanup_rate_limits; } });
Object.defineProperty(exports, "user_rate_key", { enumerable: true, get: function () { return rate_limiter_1.user_rate_key; } });
Object.defineProperty(exports, "ip_rate_key", { enumerable: true, get: function () { return rate_limiter_1.ip_rate_key; } });
Object.defineProperty(exports, "global_rate_key", { enumerable: true, get: function () { return rate_limiter_1.global_rate_key; } });
// Timeout utilities
var timeout_1 = require("./timeout");
Object.defineProperty(exports, "TimeoutError", { enumerable: true, get: function () { return timeout_1.TimeoutError; } });
Object.defineProperty(exports, "with_timeout", { enumerable: true, get: function () { return timeout_1.with_timeout; } });
Object.defineProperty(exports, "create_deferred", { enumerable: true, get: function () { return timeout_1.create_deferred; } });
Object.defineProperty(exports, "with_retry", { enumerable: true, get: function () { return timeout_1.with_retry; } });
Object.defineProperty(exports, "sleep", { enumerable: true, get: function () { return timeout_1.sleep; } });
Object.defineProperty(exports, "create_deadline", { enumerable: true, get: function () { return timeout_1.create_deadline; } });
Object.defineProperty(exports, "DEFAULT_TIMEOUTS", { enumerable: true, get: function () { return timeout_1.DEFAULT_TIMEOUTS; } });
// Job queue
var job_queue_1 = require("./job_queue");
Object.defineProperty(exports, "create_job", { enumerable: true, get: function () { return job_queue_1.create_job; } });
Object.defineProperty(exports, "get_job", { enumerable: true, get: function () { return job_queue_1.get_job; } });
Object.defineProperty(exports, "get_pending_jobs", { enumerable: true, get: function () { return job_queue_1.get_pending_jobs; } });
Object.defineProperty(exports, "mark_job_processing", { enumerable: true, get: function () { return job_queue_1.mark_job_processing; } });
Object.defineProperty(exports, "mark_job_completed", { enumerable: true, get: function () { return job_queue_1.mark_job_completed; } });
Object.defineProperty(exports, "mark_job_failed", { enumerable: true, get: function () { return job_queue_1.mark_job_failed; } });
Object.defineProperty(exports, "move_to_dlq", { enumerable: true, get: function () { return job_queue_1.move_to_dlq; } });
Object.defineProperty(exports, "reprocess_dlq_job", { enumerable: true, get: function () { return job_queue_1.reprocess_dlq_job; } });
Object.defineProperty(exports, "list_dlq_jobs", { enumerable: true, get: function () { return job_queue_1.list_dlq_jobs; } });
Object.defineProperty(exports, "get_job_stats", { enumerable: true, get: function () { return job_queue_1.get_job_stats; } });
Object.defineProperty(exports, "cleanup_completed_jobs", { enumerable: true, get: function () { return job_queue_1.cleanup_completed_jobs; } });
Object.defineProperty(exports, "claim_job", { enumerable: true, get: function () { return job_queue_1.claim_job; } });
// Runtime configuration
var config_1 = require("./config");
Object.defineProperty(exports, "DEFAULT_INFRASTRUCTURE_CONFIG", { enumerable: true, get: function () { return config_1.DEFAULT_INFRASTRUCTURE_CONFIG; } });
Object.defineProperty(exports, "get_infrastructure_config", { enumerable: true, get: function () { return config_1.get_infrastructure_config; } });
Object.defineProperty(exports, "invalidate_config_cache", { enumerable: true, get: function () { return config_1.invalidate_config_cache; } });
//# sourceMappingURL=index.js.map