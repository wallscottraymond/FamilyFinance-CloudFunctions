/**
 * Create Recurring Outflow Cloud Function
 *
 * Creates a user-defined recurring outflow (bill) in the outflows collection.
 * Unlike Plaid-synced outflows, these are manually created by users.
 *
 * Once created, the existing infrastructure will automatically generate
 * outflow_periods documents for this recurring bill.
 */
import { CreateRecurringOutflowRequest, CreateRecurringOutflowResponse } from '../../types';
/**
 * Create Recurring Outflow Cloud Function
 */
export declare const createRecurringOutflow: import("firebase-functions/v2/https").CallableFunction<CreateRecurringOutflowRequest, Promise<CreateRecurringOutflowResponse>>;
//# sourceMappingURL=createRecurringOutflow.d.ts.map