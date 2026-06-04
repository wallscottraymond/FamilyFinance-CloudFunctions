/**
 * Snapshot Quota Orchestrator
 *
 * Coordinates quota snapshot creation and alert checking.
 * Creates periodic snapshots for health monitoring.
 *
 * @module orchestrator/infrastructure/snapshot_quota
 */
import { TraceContext } from "../../types";
import { AlertStatus, QuotaAlertResult } from "../../domain/infrastructure/quota_alerts";
/**
 * Result of snapshot operation.
 */
export interface SnapshotQuotaResult {
    reads_percent: number;
    writes_percent: number;
    reads_count: number;
    writes_count: number;
    alert_status: AlertStatus;
    alert_message?: string;
}
/**
 * Orchestrates quota snapshot creation and alert checking.
 *
 * @param ctx - Trace context
 * @returns Snapshot result with alert status
 */
export declare function snapshot_quota(ctx: TraceContext): Promise<SnapshotQuotaResult>;
/**
 * Gets current quota alert status without creating a snapshot.
 *
 * @param ctx - Trace context
 * @returns Alert status based on latest snapshot
 */
export declare function check_quota_alerts(ctx: TraceContext): Promise<QuotaAlertResult & {
    reads_percent: number;
    writes_percent: number;
}>;
export { AlertStatus } from "../../domain/infrastructure/quota_alerts";
//# sourceMappingURL=snapshot_quota.orchestrator.d.ts.map