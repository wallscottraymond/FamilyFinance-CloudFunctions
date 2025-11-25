/**
 * Format Recurring Inflows Utility - FLAT STRUCTURE
 *
 * Pure Plaid → Internal format mapping for recurring inflow (income) streams.
 * This is Step 1 in the recurring inflow pipeline.
 *
 * Takes raw Plaid inflow stream data and converts it to our internal
 * FLAT inflow structure with ALL required fields from Plaid API.
 *
 * UPDATED: Now produces FLAT structure with all fields at root level.
 */
import { TransactionStream } from 'plaid';
import { Inflow } from '../../../types';
/**
 * Format Plaid inflow streams to internal Inflow documents (FLAT STRUCTURE)
 *
 * Pure mapping function - no business logic, just structure conversion.
 * Captures ALL fields from Plaid's recurring transactions API response.
 *
 * @param inflowStreams - Raw Plaid inflow streams
 * @param itemId - Plaid item ID
 * @param userId - User ID
 * @param familyId - Family ID (optional)
 * @returns Array of formatted flat inflow documents ready for Firestore
 */
export declare function formatRecurringInflows(inflowStreams: TransactionStream[], itemId: string, userId: string, familyId?: string): Promise<Partial<Inflow>[]>;
//# sourceMappingURL=formatRecurringInflows.d.ts.map