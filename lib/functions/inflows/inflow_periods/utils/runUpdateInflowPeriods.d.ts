/**
 * Update Inflow Periods Utility
 *
 * Updates all inflow periods when parent inflow changes.
 * Only updates future unreceived periods to preserve historical income data.
 *
 * Handles three types of changes:
 * 1. averageAmount - Recalculates period amounts
 * 2. userCustomName - Updates period descriptions
 * 3. transactionIds - Re-runs transaction alignment
 */
import * as admin from 'firebase-admin';
import { Inflow } from '../../../../types';
export interface InflowUpdateResult {
    success: boolean;
    periodsQueried: number;
    periodsUpdated: number;
    periodsSkipped: number;
    fieldsUpdated: string[];
    errors: string[];
}
/**
 * Main function: Update all inflow periods when parent inflow changes
 *
 * @param db - Firestore instance
 * @param inflowId - The inflow ID
 * @param inflowBefore - Inflow data before update
 * @param inflowAfter - Inflow data after update
 * @returns Result with update statistics
 */
export declare function runUpdateInflowPeriods(db: admin.firestore.Firestore, inflowId: string, inflowBefore: Partial<Inflow>, inflowAfter: Partial<Inflow>): Promise<InflowUpdateResult>;
//# sourceMappingURL=runUpdateInflowPeriods.d.ts.map