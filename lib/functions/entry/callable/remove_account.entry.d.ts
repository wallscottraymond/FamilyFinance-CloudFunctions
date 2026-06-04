/**
 * Remove Account Entry Point
 *
 * Cloud Function entry for soft-deleting an account.
 * Requires idempotency key for safe retries.
 *
 * @module entry/callable/remove_account
 */
import { FunctionResponse } from "../../types";
/**
 * Response data for remove_account.
 * Entry layer DTO - decoupled from orchestrator types.
 */
interface RemoveAccountResponseData {
    /** Whether the account was removed */
    success: boolean;
    /** The removed account ID */
    account_id: string;
    /** Whether this was a duplicate request (already processed) */
    was_idempotent: boolean;
    /** Whether this was a single account or full item removal */
    removal_type: "single_account" | "full_item";
    /** Number of transactions that will be hidden */
    transaction_count: number;
    /** Number of recurring outflows that will be soft-deleted */
    outflow_count: number;
    /** Number of recurring inflows that will be soft-deleted */
    inflow_count: number;
    /** Whether cascade jobs were enqueued for background processing */
    cascade_jobs_enqueued: boolean;
}
/**
 * Remove (soft-delete) an account.
 *
 * This operation is idempotent - calling multiple times with the same
 * idempotency_key will return the same result without re-processing.
 *
 * @param request.data.account_id - Account ID to remove
 * @param request.data.idempotency_key - Key for deduplication
 * @param request.data.debug_mode - Enable verbose logging
 * @returns Remove result
 */
export declare const remove_account: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<RemoveAccountResponseData>>, unknown>;
export {};
//# sourceMappingURL=remove_account.entry.d.ts.map