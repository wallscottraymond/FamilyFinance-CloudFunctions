/**
 * Update Outflow Periods Utility
 *
 * Updates all outflow periods when parent outflow changes.
 * Only updates future unpaid periods to preserve historical payment data.
 *
 * Handles three types of changes:
 * 1. averageAmount - Recalculates period amounts
 * 2. userCustomName - Updates period descriptions
 * 3. transactionIds - Re-runs auto-matching
 */
import * as admin from 'firebase-admin';
import { Outflow } from '../../../types';
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