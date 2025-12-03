/**
 * Batch Create Recurring Streams Utility
 *
 * Handles bulk creation/updating of recurring inflows and outflows.
 * This is the final step in the recurring transaction pipeline.
 */
/**
 * Batch create or update inflow streams - FLAT STRUCTURE
 *
 * Checks if streams already exist and updates them, otherwise creates new ones.
 * Uses Plaid stream_id (stored in inflow.id) as the Firestore document ID.
 *
 * @param inflows - Array of FLAT inflow documents to create/update
 * @param userId - User ID for ownership verification
 * @returns Count of created and updated inflows
 */
export declare function batchCreateInflowStreams(inflows: any[], userId: string): Promise<{
    created: number;
    updated: number;
    errors: string[];
}>;
/**
 * Batch create or update outflow streams - FLAT STRUCTURE
 *
 * Checks if streams already exist and updates them, otherwise creates new ones.
 * Uses Plaid stream_id (stored in outflow.id) as the Firestore document ID.
 *
 * @param outflows - Array of FLAT outflow documents to create/update
 * @param userId - User ID for ownership verification
 * @returns Count of created and updated outflows
 */
export declare function batchCreateOutflowStreams(outflows: any[], userId: string): Promise<{
    created: number;
    updated: number;
    errors: string[];
}>;
//# sourceMappingURL=batchCreateRecurringStreams.d.ts.map