"use strict";
/**
 * Retry Pending Item Removals Orchestrator
 *
 * When an account removal's Plaid `itemRemove` failed, the item stays connected
 * at Plaid (and billed) and is flagged `removalPending`. This retries the
 * removal and, on success, soft-deletes the item. Runs from the 4h scheduled job.
 *
 * @module orchestrators/plaid/retry_pending_item_removals
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.retry_pending_item_removals_orchestrator = retry_pending_item_removals_orchestrator;
const observability_1 = require("../../observability");
const pending_item_removal_resolver_1 = require("../../resolvers/plaid/pending_item_removal.resolver");
const plaid_1 = require("../../integrations/plaid");
const plaid_item_repo_1 = require("../../repositories/plaid/plaid_item.repo");
/**
 * Retries Plaid removal for every flagged item.
 *
 * @param ctx - Trace context
 * @returns Counts for the run
 */
async function retry_pending_item_removals_orchestrator(ctx) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "retry_pending_item_removals");
    (0, observability_1.log_operation_start)(span, "system");
    const result = { attempted: 0, removed: 0, still_pending: 0 };
    const items = await (0, pending_item_removal_resolver_1.resolve_pending_item_removals)(ctx);
    for (const item of items) {
        result.attempted++;
        let removed = false;
        if (item.access_token) {
            try {
                removed = (await (0, plaid_1.remove_item)(item.access_token)).success;
            }
            catch (error) {
                console.warn(`[${ctx.trace_id}] Retry itemRemove failed for ${item.item_doc_id}:`, error);
            }
        }
        if (!removed) {
            result.still_pending++;
            continue;
        }
        /* eslint-disable-next-line @typescript-eslint/naming-convention */
        await plaid_item_repo_1.plaid_item_repo.apply_field_update(ctx, item.item_doc_id, { removalPending: false });
        await plaid_item_repo_1.plaid_item_repo.soft_delete(ctx, item.item_doc_id, item.user_id);
        result.removed++;
    }
    (0, observability_1.log_operation_success)(span, "system");
    return result;
}
//# sourceMappingURL=retry_pending_item_removals.orchestrator.js.map