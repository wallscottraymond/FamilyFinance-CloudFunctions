/**
 * Sync Notes to Overlapping Periods Utility
 *
 * When userNotes is updated on a budget_period, this utility syncs the notes
 * to all overlapping periods of OTHER budget types (same date range, different period type).
 *
 * Example:
 * - User adds note to Monthly period (2025-04-01 to 2025-04-30)
 * - Note syncs to overlapping Weekly periods (2025-W14, 2025-W15, etc.)
 * - Note syncs to overlapping Bi-Monthly periods (2025-BM04A, 2025-BM04B)
 *
 * Note: This syncs notes for the SAME BUDGET across different period types,
 * not across different budgets.
 */
import * as admin from 'firebase-admin';
import { BudgetPeriodDocument } from '../../../types';
export interface NoteSyncResult {
    success: boolean;
    periodsQueried: number;
    periodsUpdated: number;
    periodTypes: string[];
    errors: string[];
}
/**
 * Sync notes from one budget period to all overlapping periods of other types
 *
 * @param db - Firestore instance
 * @param sourcePeriod - The period that was updated with new notes
 * @param newNotes - The new notes value to sync
 * @returns Result with sync statistics
 */
export declare function syncNotesToOverlappingPeriods(db: admin.firestore.Firestore, sourcePeriod: BudgetPeriodDocument, newNotes: string | undefined): Promise<NoteSyncResult>;
/**
 * Sync checklist items to overlapping periods
 * Similar to notes sync, but for checklistItems array
 *
 * @param db - Firestore instance
 * @param sourcePeriod - The period that was updated
 * @param newChecklistItems - The new checklist items to sync
 * @returns Result with sync statistics
 */
export declare function syncChecklistToOverlappingPeriods(db: admin.firestore.Firestore, sourcePeriod: BudgetPeriodDocument, newChecklistItems: any[]): Promise<NoteSyncResult>;
/**
 * Sync modifiedAmount to overlapping periods
 * When a user modifies the allocated amount for a specific period,
 * sync that modification to overlapping periods of other types
 *
 * @param db - Firestore instance
 * @param sourcePeriod - The period with the modified amount
 * @param newModifiedAmount - The new modified amount
 * @returns Result with sync statistics
 */
export declare function syncModifiedAmountToOverlappingPeriods(db: admin.firestore.Firestore, sourcePeriod: BudgetPeriodDocument, newModifiedAmount: number | undefined): Promise<NoteSyncResult>;
//# sourceMappingURL=syncNotesToOverlappingPeriods.d.ts.map