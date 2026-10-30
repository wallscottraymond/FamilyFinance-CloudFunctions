/**
 * Update Outflow Periods Utility
 *
 * Updates all outflow periods when parent outflow changes.
 * Only updates future unpaid periods to preserve historical payment data.
 *
 * Handles EXPECTED amounts and names/metadata only. What was PAID is written by
 * reconcile_recurring_period alone (on_recurring_updated enqueues it when transactionIds
 * change); the legacy auto-match + occurrence matcher that also ran here was retired
 * 2026-10-30 (Code-Health-Review F3 / M4-H2), as its income twin was (F1).
 */
import * as admin from "firebase-admin";
import { Outflow } from "../../../../types";
export interface OutflowUpdateResult {
    success: boolean;
    periodsQueried: number;
    periodsUpdated: number;
    periodsSkipped: number;
    fieldsUpdated: string[];
    errors: string[];
}
/**
 * Main function: Update all outflow periods when parent outflow changes
 *
 * @param db - Firestore instance
 * @param outflowId - The outflow ID
 * @param outflowBefore - Outflow data before update
 * @param outflowAfter - Outflow data after update
 * @returns Result with update statistics
 */
export declare function runUpdateOutflowPeriods(db: admin.firestore.Firestore, outflowId: string, outflowBefore: Outflow, outflowAfter: Outflow): Promise<OutflowUpdateResult>;
//# sourceMappingURL=runUpdateOutflowPeriods.d.ts.map