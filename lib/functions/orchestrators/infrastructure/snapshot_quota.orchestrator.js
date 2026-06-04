"use strict";
/**
 * Snapshot Quota Orchestrator
 *
 * Coordinates quota snapshot creation and alert checking.
 * Creates periodic snapshots for health monitoring.
 *
 * @module orchestrator/infrastructure/snapshot_quota
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshot_quota = snapshot_quota;
exports.check_quota_alerts = check_quota_alerts;
const observability_1 = require("../../observability");
const infrastructure_1 = require("../../repositories/infrastructure");
const config_1 = require("../../infrastructure/config");
const quota_alerts_1 = require("../../domain/infrastructure/quota_alerts");
/**
 * Orchestrates quota snapshot creation and alert checking.
 *
 * @param ctx - Trace context
 * @returns Snapshot result with alert status
 */
async function snapshot_quota(ctx) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "snapshot_quota");
    (0, observability_1.log_operation_start)(span);
    try {
        // Get configuration
        const config = await (0, config_1.get_infrastructure_config)();
        // Get current usage from repository
        const usage = await (0, infrastructure_1.get_today_usage)(ctx);
        // Use domain function to calculate percentages
        const percentages = (0, quota_alerts_1.calculate_usage_percentages)(usage.reads, usage.writes, {
            daily_reads: config.quota.daily_reads_limit,
            daily_writes: config.quota.daily_writes_limit,
        });
        // Save snapshot via repository
        await (0, infrastructure_1.save_quota_snapshot)(ctx, {
            reads_percent: percentages.reads_percent,
            writes_percent: percentages.writes_percent,
            reads_count: usage.reads,
            writes_count: usage.writes,
            limits: {
                daily_reads: config.quota.daily_reads_limit,
                daily_writes: config.quota.daily_writes_limit,
            },
        });
        // Use domain function to determine alert status
        const alert = (0, quota_alerts_1.determine_alert_status)(percentages, {
            warning_threshold_percent: config.quota.warning_threshold_percent,
            critical_threshold_percent: config.quota.critical_threshold_percent,
        });
        (0, observability_1.log_operation_success)(span);
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "snapshot_quota",
            status: "success",
            output: {
                reads_percent: percentages.reads_percent,
                writes_percent: percentages.writes_percent,
                reads_count: usage.reads,
                writes_count: usage.writes,
                alert_status: alert.status,
            },
        }));
        return {
            reads_percent: percentages.reads_percent,
            writes_percent: percentages.writes_percent,
            reads_count: usage.reads,
            writes_count: usage.writes,
            alert_status: alert.status,
            alert_message: alert.message,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { error_code: "SNAPSHOT_QUOTA_FAILED" });
        throw error;
    }
}
/**
 * Gets current quota alert status without creating a snapshot.
 *
 * @param ctx - Trace context
 * @returns Alert status based on latest snapshot
 */
async function check_quota_alerts(ctx) {
    const snapshot = await (0, infrastructure_1.get_latest_quota_snapshot)(ctx);
    if (!snapshot) {
        return {
            status: "ok",
            message: "No quota data available",
            max_usage_percent: 0,
            reads_percent: 0,
            writes_percent: 0,
        };
    }
    const config = await (0, config_1.get_infrastructure_config)();
    const alert = (0, quota_alerts_1.determine_alert_status)({ reads_percent: snapshot.reads_percent, writes_percent: snapshot.writes_percent }, {
        warning_threshold_percent: config.quota.warning_threshold_percent,
        critical_threshold_percent: config.quota.critical_threshold_percent,
    });
    return Object.assign(Object.assign({}, alert), { reads_percent: snapshot.reads_percent, writes_percent: snapshot.writes_percent });
}
//# sourceMappingURL=snapshot_quota.orchestrator.js.map