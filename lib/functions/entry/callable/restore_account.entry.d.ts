/**
 * Restore Account Entry Point
 *
 * Cloud Function entry for restoring a soft-deleted account.
 * Only accounts that were single-account removals can be restored.
 *
 * @module entry/callable/restore_account
 */
import { FunctionResponse } from "../../types";
/**
 * Response data for restore_account.
 */
interface RestoreAccountResponseData {
    /** Whether the account was restored */
    success: boolean;
    /** The restored account ID */
    account_id: string;
    /** Whether this was a duplicate request */
    was_idempotent: boolean;
    /** Whether restore jobs were enqueued */
    restore_jobs_enqueued: boolean;
}
/**
 * Restore a soft-deleted account.
 *
 * Only accounts that were removed via single-account removal
 * (Plaid item still active) can be restored.
 *
 * @param request.data.account_id - Account ID to restore
 * @param request.data.idempotency_key - Key for deduplication
 * @param request.data.restore_transactions - Whether to un-hide transactions
 * @param request.data.restore_recurring - Whether to restore recurring items
 * @returns Restore result
 */
export declare const restore_account: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<RestoreAccountResponseData>>, unknown>;
export {};
//# sourceMappingURL=restore_account.entry.d.ts.map