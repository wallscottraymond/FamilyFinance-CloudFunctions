/**
 * Outflow Period Creation Utilities - FLAT STRUCTURE
 *
 * Provides utilities for creating and managing outflow_periods based on
 * recurring outflows and source periods.
 *
 * UPDATED: Complete flat structure with multi-occurrence tracking.
 * This is the single source of truth for outflow period generation.
 */
import * as admin from 'firebase-admin';
import { OutflowPeriod } from '../../../types';
/**
 * Result of creating outflow periods
 */
export interface CreateOutflowPeriodsResult {
    periodsCreated: number;
    periodIds: string[];
}
/**
 * Calculate the date range for outflow period generation
 *
 * @param outflow - The recurring outflow (supports both flat and nested structure)
 * @param monthsForward - Number of months to generate forward from now (default: 15)
 * @returns Object with startDate and endDate
 */
export declare function calculatePeriodGenerationRange(outflow: any, monthsForward?: number): {
    startDate: Date;
    endDate: Date;
};
/**
 * Create outflow periods from source periods for a given outflow - FLAT STRUCTURE
 *
 * UPDATED: Complete flat structure with multi-occurrence tracking.
 * - All fields at root level (no nested access, categories, metadata, relationships objects)
 * - Uses calculateAllOccurrencesInPeriod to handle variable occurrences (4 vs 5 Mondays)
 * - Tracks individual occurrence due dates, payment status, and transaction IDs
 * - Supports both unit tracking (2/4 paid) and dollar tracking ($20/$40)
 *
 * @param db - Firestore instance
 * @param outflowId - The outflow document ID
 * @param outflow - The recurring outflow data (flat structure)
 * @param startDate - Start date for period generation
 * @param endDate - End date for period generation
 * @returns Result with count and IDs of created periods
 */
export declare function createOutflowPeriodsFromSource(db: admin.firestore.Firestore, outflowId: string, outflow: any, // Accept flat outflow structure
startDate: Date, endDate: Date): Promise<CreateOutflowPeriodsResult>;
/**
 * Efficiently create multiple outflow_periods using Firestore batch operations
 *
 * @param db - Firestore instance
 * @param outflowPeriods - Array of outflow periods to create
 */
export declare function batchCreateOutflowPeriods(db: admin.firestore.Firestore, outflowPeriods: OutflowPeriod[]): Promise<void>;
//# sourceMappingURL=outflowPeriods.d.ts.map