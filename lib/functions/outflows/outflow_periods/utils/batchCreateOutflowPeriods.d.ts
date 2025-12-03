/**
 * Batch create outflow periods using Firestore batch operations
 */
import * as admin from 'firebase-admin';
import { OutflowPeriod } from '../../../../types';
/**
 * Efficiently create multiple outflow_periods using Firestore batch operations
 *
 * @param db - Firestore instance
 * @param outflowPeriods - Array of outflow periods to create
 */
export declare function batchCreateOutflowPeriods(db: admin.firestore.Firestore, outflowPeriods: OutflowPeriod[]): Promise<void>;
//# sourceMappingURL=batchCreateOutflowPeriods.d.ts.map