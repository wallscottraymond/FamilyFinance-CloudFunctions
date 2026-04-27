/**
 * Handle Budget Period Pause/Resume
 *
 * When a budget period is paused (isActive = false):
 * 1. Reassign transaction splits to "Everything Else" budget
 * 2. Store original budgetId in split for restore
 * 3. Add allocation to Everything Else period
 *
 * When a budget period is resumed (isActive = true):
 * 1. Reclaim transaction splits that were originally from this budget
 * 2. Restore Everything Else allocation
 *
 * This only affects the specific budget period being toggled.
 */
import * as admin from 'firebase-admin';
import { BudgetPeriodDocument } from '../../../types';
export interface PauseResumeResult {
    success: boolean;
    action: 'paused' | 'resumed' | 'skipped';
    message: string;
    splitsReassigned: number;
    amountRedistributed: number;
    error: string | null;
}
/**
 * Handle pause/resume for a specific budget period
 */
export declare function handleBudgetPeriodPauseResume(db: admin.firestore.Firestore, periodId: string, periodData: BudgetPeriodDocument, isPausing: boolean): Promise<PauseResumeResult>;
//# sourceMappingURL=handleBudgetPeriodPauseResume.d.ts.map