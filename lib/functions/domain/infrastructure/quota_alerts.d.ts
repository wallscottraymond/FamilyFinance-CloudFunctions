/**
 * Quota Alert Domain Logic
 *
 * Pure functions for determining quota alert status.
 * No IO, no side effects - just business rule evaluation.
 *
 * @module domain/infrastructure/quota_alerts
 */
/**
 * Alert status levels.
 */
export type AlertStatus = "ok" | "warning" | "critical";
/**
 * Quota usage input for alert determination.
 */
export interface QuotaUsage {
    reads_percent: number;
    writes_percent: number;
}
/**
 * Threshold configuration for alerts.
 */
export interface AlertThresholds {
    warning_threshold_percent: number;
    critical_threshold_percent: number;
}
/**
 * Result of quota alert determination.
 */
export interface QuotaAlertResult {
    status: AlertStatus;
    message?: string;
    max_usage_percent: number;
}
/**
 * Determines the alert status based on quota usage and thresholds.
 *
 * This is a PURE function - same inputs always produce same outputs.
 * No IO, no side effects.
 *
 * @param usage - Current quota usage percentages
 * @param thresholds - Alert threshold configuration
 * @returns Alert result with status and optional message
 *
 * @example
 * const result = determine_alert_status(
 *   { reads_percent: 85, writes_percent: 50 },
 *   { warning_threshold_percent: 80, critical_threshold_percent: 95 }
 * );
 * // result = { status: "warning", message: "...", max_usage_percent: 85 }
 */
export declare function determine_alert_status(usage: QuotaUsage, thresholds: AlertThresholds): QuotaAlertResult;
/**
 * Calculates quota usage percentages from raw counts.
 *
 * @param reads - Number of reads
 * @param writes - Number of writes
 * @param limits - Daily limits
 * @returns Usage percentages
 */
export declare function calculate_usage_percentages(reads: number, writes: number, limits: {
    daily_reads: number;
    daily_writes: number;
}): QuotaUsage;
//# sourceMappingURL=quota_alerts.d.ts.map