import { PeriodType } from "../../../../types";
/**
 * Operation types supported by batch update
 */
export type SummaryOperation = {
    type: 'recalculate';
    data: RecalculateOperationData;
} | {
    type: 'updateNames';
    data: UpdateNamesOperationData;
};
interface RecalculateOperationData {
    sourcePeriodId: string;
    ownerId: string;
    ownerType: 'user' | 'group';
    periodType: PeriodType;
}
interface UpdateNamesOperationData {
    outflowId: string;
    merchant: string;
    userCustomName: string;
}
/**
 * Batch Update Summary - Core Orchestration Function
 *
 * Coordinates multiple update operations into a single atomic Firestore write.
 * This ensures all changes succeed or fail together, maintaining data consistency.
 *
 * Supported Operations:
 * - 'recalculate': Recalculate a specific sourcePeriodId group
 * - 'updateNames': Update merchant/userCustomName for an outflow
 *
 * Process:
 * 1. Fetch current summary document (or create if missing)
 * 2. Execute all operations sequentially on in-memory copy
 * 3. Collect all changes
 * 4. Single Firestore batch write with all updates
 * 5. Update metadata (lastRecalculated, updatedAt, totalItemCount)
 *
 * @param params - Batch update parameters
 */
export declare function batchUpdateSummary(params: {
    summaryId: string;
    operations: SummaryOperation[];
}): Promise<void>;
/**
 * Helper function to get or create summary ID
 */
export declare function getSummaryId(ownerId: string, ownerType: 'user' | 'group', periodType: PeriodType): string;
export {};
//# sourceMappingURL=batchUpdateSummary.d.ts.map