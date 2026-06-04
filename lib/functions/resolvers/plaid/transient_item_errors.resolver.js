"use strict";
/**
 * Transient Item Errors Resolver
 *
 * READ-ONLY impact analysis for the auto-retry job: find the active Plaid items
 * currently sitting in a transient error state (institution down / rate limited)
 * that are candidates for a silent retry. No mutations.
 *
 * @module resolvers/plaid/transient_item_errors
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_transient_items_to_retry = resolve_transient_items_to_retry;
const observability_1 = require("../../observability");
const plaid_item_repo_1 = require("../../repositories/plaid/plaid_item.repo");
const item_status_webhook_types_1 = require("../../types/plaid/item_status_webhook.types");
const transient_error_retry_types_1 = require("../../types/plaid/transient_error_retry.types");
/**
 * The transient statuses the retry job acts on.
 */
const TRANSIENT_STATUSES = [
    item_status_webhook_types_1.ItemStatusValues.TEMPORARY_ERROR,
    item_status_webhook_types_1.ItemStatusValues.RATE_LIMITED,
];
/**
 * Resolves the items awaiting a silent retry.
 *
 * @param ctx - Trace context
 * @returns Items in a transient error state (capped at MAX_ITEMS_PER_RUN)
 */
async function resolve_transient_items_to_retry(ctx) {
    const span = (0, observability_1.create_span)(ctx, "resolver", "resolve_transient_items_to_retry");
    (0, observability_1.log_operation_start)(span, "system");
    const items = await plaid_item_repo_1.plaid_item_repo.get_in_transient_state(ctx, TRANSIENT_STATUSES);
    (0, observability_1.log_operation_success)(span, "system");
    return items.slice(0, transient_error_retry_types_1.MAX_ITEMS_PER_RUN);
}
//# sourceMappingURL=transient_item_errors.resolver.js.map