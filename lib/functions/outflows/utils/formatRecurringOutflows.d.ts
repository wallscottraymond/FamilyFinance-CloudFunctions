/**
 * Format Recurring Outflows Utility - FLAT STRUCTURE
 *
 * Pure Plaid → Internal format mapping for recurring outflow (expense) streams.
 * This is Step 1 in the recurring outflow pipeline.
 *
 * Takes raw Plaid outflow stream data and converts it to our FLAT internal
 * outflow structure with ALL fields at root level (no nested objects).
 *
 * IMPORTANT: This produces the NEW flat structure. Old outflows with nested
 * structure will remain untouched and continue to work.
 */
import { TransactionStream } from 'plaid';
import { Outflow } from '../../../types';
/**
 * Format Plaid outflow streams to flat Outflow documents
 *
 * Pure mapping function - no business logic, just structure conversion.
 * Captures ALL fields from Plaid's recurring transactions API response.
 *
 * @param outflowStreams - Raw Plaid outflow streams
 * @param itemId - Plaid item ID
 * @param userId - User ID
 * @param familyId - Family ID (optional)
 * @returns Array of flat outflow documents ready for Firestore
 */
export declare function formatRecurringOutflows(outflowStreams: TransactionStream[], itemId: string, userId: string, familyId?: string): Promise<Outflow[]>;
//# sourceMappingURL=formatRecurringOutflows.d.ts.map