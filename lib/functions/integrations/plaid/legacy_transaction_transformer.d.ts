/**
 * Legacy Transaction Transformer
 *
 * PURE transformer functions to convert legacy FamilyTransaction
 * (camelCase) to TransactionForPersistence (snake_case).
 *
 * This bridges the existing 6-step pipeline output with the
 * new architecture-compliant repository layer.
 *
 * @module integrations/plaid/legacy_transaction_transformer
 */
import { Transaction as FamilyTransaction } from "../../../types";
import { TransactionForPersistence } from "../../types/plaid";
/**
 * Transforms legacy FamilyTransaction array to TransactionForPersistence array.
 *
 * PURE FUNCTION - no IO, no side effects, deterministic.
 *
 * @param transactions - Legacy transactions from the 6-step pipeline
 * @param user_id - User ID for ownership
 * @param group_ids - Group IDs for access control
 * @returns Array of transactions ready for the new repository
 */
export declare function transform_legacy_to_persistence(transactions: FamilyTransaction[], user_id: string, group_ids: string[]): TransactionForPersistence[];
//# sourceMappingURL=legacy_transaction_transformer.d.ts.map