/**
 * Create Manual Outflow Cloud Function
 *
 * Creates a user-defined (manual) recurring outflow (bill) in the outflows collection.
 * Unlike Plaid-synced outflows, these are manually created by users.
 *
 * Once created, the existing infrastructure will automatically generate
 * outflow_periods documents for this recurring bill.
 */
import { CreateRecurringOutflowRequest, CreateRecurringOutflowResponse } from '../types';
/**
 * Create Manual Outflow Cloud Function
 */
export declare const createManualOutflow: import("firebase-functions/v2/https").CallableFunction<CreateRecurringOutflowRequest, Promise<CreateRecurringOutflowResponse>>;
//# sourceMappingURL=createManualOutflow.d.ts.map