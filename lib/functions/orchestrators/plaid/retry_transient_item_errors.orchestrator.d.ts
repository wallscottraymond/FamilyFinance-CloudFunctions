/**
 * Retry Transient Item Errors Orchestrator
 *
 * Background auto-retry for Plaid items in a transient error state (institution
 * down / rate limited). For each such item it runs a fresh balance-sync probe:
 *  - success            → clear the error, mark the connection healthy (silent)
 *  - failure < 24h       → keep retrying silently (no user-facing change)
 *  - failure ≥ 24h       → escalate to the user as needing a reconnect
 *
 * Invoked from the scheduled entry every 4 hours. Items that recover or escalate
 * leave the transient status, so they are not reprocessed.
 *
 * @module orchestrators/plaid/retry_transient_item_errors
 */
import { TraceContext } from "../../types";
import { RetryTransientErrorsResponse } from "../../types/plaid/transient_error_retry.types";
/**
 * Runs one auto-retry pass over all items in a transient error state.
 *
 * @param ctx - Trace context
 * @returns Aggregated counts for the run
 */
export declare function retry_transient_item_errors_orchestrator(ctx: TraceContext): Promise<RetryTransientErrorsResponse>;
//# sourceMappingURL=retry_transient_item_errors.orchestrator.d.ts.map