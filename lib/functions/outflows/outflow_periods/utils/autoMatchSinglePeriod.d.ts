/**
 * Auto-Match Transactions to Single Outflow Period
 *
 * This utility matches historical transactions to a specific outflow period
 * when that period is created. Runs as part of the onOutflowPeriodCreate trigger.
 */
import * as admin from 'firebase-admin';
import { OutflowPeriod, Outflow, OutflowPeriodStatus } from '../../../../types';
export interface AutoMatchSinglePeriodResult {
    success: boolean;
    transactionsMatched: number;
    splitsAssigned: number;
    periodUpdated: boolean;
    finalStatus: OutflowPeriodStatus | null;
    errors: string[];
}
/**
 * Auto-match transactions to a single outflow period
 *
 * @param db - Firestore instance
 * @param periodId - The outflow period ID
 * @param period - The outflow period data
 * @param outflow - The parent outflow (flat structure)
 * @returns Result with match statistics
 */
export declare function autoMatchSinglePeriod(db: admin.firestore.Firestore, periodId: string, period: OutflowPeriod, outflow: Outflow): Promise<AutoMatchSinglePeriodResult>;
//# sourceMappingURL=autoMatchSinglePeriod.d.ts.map