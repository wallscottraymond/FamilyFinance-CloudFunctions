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
export function determine_alert_status(
  usage: QuotaUsage,
  thresholds: AlertThresholds
): QuotaAlertResult {
  const max_percent = Math.max(usage.reads_percent, usage.writes_percent);

  if (max_percent >= thresholds.critical_threshold_percent) {
    return {
      status: "critical",
      message: format_alert_message("critical", usage),
      max_usage_percent: max_percent,
    };
  }

  if (max_percent >= thresholds.warning_threshold_percent) {
    return {
      status: "warning",
      message: format_alert_message("warning", usage),
      max_usage_percent: max_percent,
    };
  }

  return {
    status: "ok",
    max_usage_percent: max_percent,
  };
}

/**
 * Formats an alert message for a given status.
 *
 * @param status - Alert status (warning or critical)
 * @param usage - Quota usage
 * @returns Formatted message
 */
function format_alert_message(
  status: "warning" | "critical",
  usage: QuotaUsage
): string {
  const label = status === "critical" ? "Quota critical" : "Quota warning";
  return `${label}: reads ${usage.reads_percent}%, writes ${usage.writes_percent}%`;
}

/**
 * Calculates quota usage percentages from raw counts.
 *
 * @param reads - Number of reads
 * @param writes - Number of writes
 * @param limits - Daily limits
 * @returns Usage percentages
 */
export function calculate_usage_percentages(
  reads: number,
  writes: number,
  limits: { daily_reads: number; daily_writes: number }
): QuotaUsage {
  return {
    reads_percent: Math.round((reads / limits.daily_reads) * 100),
    writes_percent: Math.round((writes / limits.daily_writes) * 100),
  };
}
