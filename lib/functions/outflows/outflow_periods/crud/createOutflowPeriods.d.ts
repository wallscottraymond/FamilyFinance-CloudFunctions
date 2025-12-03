/**
 * Outflow Period Creation - FLAT STRUCTURE
 *
 * Pure creation function for outflow_periods based on recurring outflows and source periods.
 * This is the single source of truth for outflow period generation.
 *
 * ARCHITECTURE: This is a pure orchestration function that delegates to utilities.
 */
import * as admin from 'firebase-admin';
/**
 * Result of creating outflow periods
 */
export interface CreateOutflowPeriodsResult {
    periodsCreated: number;
    periodIds: string[];
}
export { calculatePeriodGenerationRange } from '../utils';
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
//# sourceMappingURL=createOutflowPeriods.d.ts.map