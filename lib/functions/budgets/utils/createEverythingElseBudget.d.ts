/**
 * createEverythingElseBudget - System Budget Creation Utility
 *
 * Creates the "everything else" budget - a permanent catch-all budget that
 * captures transaction splits not assigned to any other budget.
 *
 * Key Characteristics:
 * - Auto-created for users on signup
 * - Cannot be deleted by users
 * - Amount is always $0 (calculated from spending)
 * - Name is editable, but other fields are not
 * - Owns ALL categories by default (transferred away when regular budgets are created)
 *
 * @module budgets/utils/createEverythingElseBudget
 */
import { Firestore } from 'firebase-admin/firestore';
export declare function createEverythingElseBudget(db: Firestore, userId: string, userCurrency?: string): Promise<string>;
//# sourceMappingURL=createEverythingElseBudget.d.ts.map