"use strict";
/**
 * Re-authentication Recovery Orchestrators
 *
 * Confirms that a Plaid item needing re-authentication works again, marks it
 * healthy, and refreshes its data (balances, transactions, recurring).
 *
 * Three ways in, one path:
 *  - `complete_relink` callable: the app calls it right after update-mode Link
 *    succeeds (Plaid sends no webhook for an in-app repair).
 *  - Scheduled self-heal: every 4h, probes items still flagged for re-auth, so a
 *    repair is picked up even when the app never reported it (older builds) or
 *    the user fixed it at the bank.
 *  - LOGIN_REPAIRED webhook (`handle_login_repaired`): Plaid says it's fixed, so
 *    no probe is needed — it calls `mark_item_repaired` + `refresh_repaired_item`.
 *
 * @module orchestrators/plaid/reauth_recovery
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mark_item_repaired = mark_item_repaired;
exports.refresh_repaired_item = refresh_repaired_item;
exports.complete_relink_orchestrator = complete_relink_orchestrator;
exports.self_heal_reauth_items_orchestrator = self_heal_reauth_items_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const observability_1 = require("../../observability");
const plaid_1 = require("../../repositories/plaid");
const relink_attempt_repo_1 = require("../../repositories/plaid/relink_attempt.repo");
const plaid_2 = require("../../integrations/plaid");
const reauth_item_resolver_1 = require("../../resolvers/plaid/reauth_item.resolver");
const reauth_recovery_service_1 = require("../../domain/plaid/reauth_recovery.service");
const item_status_webhook_service_1 = require("../../domain/plaid/item_status_webhook.service");
const sync_balances_orchestrator_1 = require("./sync_balances.orchestrator");
const sync_transactions_orchestrator_1 = require("./sync_transactions.orchestrator");
const sync_recurring_orchestrator_1 = require("./sync_recurring.orchestrator");
/**
 * Asks Plaid whether the item works. Never throws — any failure means "not yet".
 */
async function probe_reauth_item(item) {
    const result = {
        accounts_ok: false,
        consent_expiration_ms: null,
        consent_checked: false,
    };
    if (!item.access_token) {
        return result;
    }
    try {
        await (0, plaid_2.fetch_plaid_accounts)(item.access_token);
        result.accounts_ok = true;
    }
    catch (_a) {
        return result;
    }
    if ((0, reauth_recovery_service_1.needs_consent_check)(item.status)) {
        try {
            const plaid_item = await (0, plaid_2.fetch_plaid_item)(item.access_token);
            result.consent_checked = true;
            result.consent_expiration_ms = plaid_item.consent_expiration_time
                ? new Date(plaid_item.consent_expiration_time).getTime()
                : null;
        }
        catch (_b) {
            // consent_checked stays false → not recovered
        }
    }
    return result;
}
/**
 * Clears the item's error state and closes its open relink attempts.
 *
 * @param ctx - Trace context
 * @param target - The item to mark healthy
 */
async function mark_item_repaired(ctx, target) {
    const update = (0, item_status_webhook_service_1.compute_login_repaired_update)();
    /* eslint-disable @typescript-eslint/naming-convention */
    await plaid_1.plaid_item_repo.apply_field_update(ctx, target.item_doc_id, {
        status: update.status,
        error: null,
        errorMessage: null,
        errorAt: null,
        requiresReauth: false,
        consentExpiresAt: null,
        transientSince: null,
        retryCount: 0,
    });
    /* eslint-enable @typescript-eslint/naming-convention */
    await relink_attempt_repo_1.relink_attempt_repo.mark_all_successful_for_item(ctx, target.item_doc_id);
}
/**
 * Pulls everything that may have been missed while the item was broken:
 * balances, transactions (cursor-based, so only the gap), and recurring streams.
 * Each step is independent; a failure in one doesn't stop the others.
 *
 * @param ctx - Trace context
 * @param target - The repaired item
 * @returns Whether every step succeeded
 */
async function refresh_repaired_item(ctx, target) {
    let all_ok = true;
    const key = `reauth_refresh:${target.item_doc_id}:${ctx.trace_id}`;
    try {
        await (0, sync_balances_orchestrator_1.sync_balances_orchestrator)({
            trace_id: ctx.trace_id,
            span_id: (0, observability_1.generate_id)(),
            input: { item_id: target.plaid_item_id },
            user_id: target.user_id,
            idempotency_key: `${key}:balances`,
        });
    }
    catch (error) {
        all_ok = false;
        console.error(`[${ctx.trace_id}] Balance refresh failed for ${target.item_doc_id}:`, error);
    }
    try {
        const sync = await (0, sync_transactions_orchestrator_1.sync_transactions_orchestrator)({
            trace_id: ctx.trace_id,
            span_id: (0, observability_1.generate_id)(),
            input: { item_id: target.plaid_item_id, user_id: target.user_id },
            user_id: target.user_id,
            idempotency_key: `${key}:transactions`,
        });
        all_ok = all_ok && sync.success;
    }
    catch (error) {
        all_ok = false;
        console.error(`[${ctx.trace_id}] Transaction refresh failed for ${target.item_doc_id}:`, error);
    }
    try {
        const sync = await (0, sync_recurring_orchestrator_1.sync_recurring_orchestrator)({
            trace_id: ctx.trace_id,
            span_id: (0, observability_1.generate_id)(),
            input: { item_id: target.plaid_item_id, is_webhook: false },
            user_id: target.user_id,
            idempotency_key: `${key}:recurring`,
        });
        all_ok = all_ok && sync.success;
    }
    catch (error) {
        all_ok = false;
        console.error(`[${ctx.trace_id}] Recurring refresh failed for ${target.item_doc_id}:`, error);
    }
    return all_ok;
}
/**
 * Called by the app right after update-mode Link succeeds. Confirms with Plaid
 * that the item works, then marks it healthy and refreshes its data.
 *
 * @param ctx - Orchestrator context (input.item_id = item document ID)
 * @returns Whether the item is repaired, its status, and whether data refreshed
 */
async function complete_relink_orchestrator(ctx) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "complete_relink");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    try {
        // 1. RESOLVER
        const item = await (0, reauth_item_resolver_1.resolve_reauth_item)(ctx, ctx.input.item_id);
        if (!item || item.user_id !== ctx.user_id || !item.is_active) {
            return { success: false, error_code: "NOT_FOUND", error: "Bank connection not found" };
        }
        // Already healthy (e.g. the self-heal pass or a webhook got there first).
        if (item.status === "good") {
            (0, observability_1.log_operation_success)(span, ctx.user_id);
            return { success: true, data: { repaired: true, status: "good", refreshed: false } };
        }
        // 2. PROBE (integration) + DOMAIN decision
        const probe = await probe_reauth_item(item);
        const recovered = (0, reauth_recovery_service_1.is_reauth_recovered)(item.status, probe, firestore_1.Timestamp.now().toMillis());
        if (!recovered) {
            (0, observability_1.log_operation_success)(span, ctx.user_id);
            return { success: true, data: { repaired: false, status: item.status, refreshed: false } };
        }
        // 3. REPOSITORY + refresh
        await mark_item_repaired(ctx, item);
        const refreshed = await refresh_repaired_item(ctx, item);
        (0, observability_1.log_operation_success)(span, ctx.user_id);
        return { success: true, data: { repaired: true, status: "good", refreshed } };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: ctx.user_id, error_code: "COMPLETE_RELINK_FAILED" });
        return {
            success: false,
            error_code: "COMPLETE_RELINK_FAILED",
            error: "Unable to confirm the reconnection. Please try again later.",
        };
    }
}
/**
 * Scheduled self-heal: probes every item still flagged for re-auth and repairs
 * the ones that work again.
 *
 * @param ctx - Trace context
 * @returns Counts for the run
 */
async function self_heal_reauth_items_orchestrator(ctx) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "self_heal_reauth_items");
    (0, observability_1.log_operation_start)(span, "system");
    const result = { probed: 0, repaired: 0, still_needs_reauth: 0 };
    const items = await (0, reauth_item_resolver_1.resolve_reauth_items_to_probe)(ctx);
    for (const item of items) {
        result.probed++;
        const probe = await probe_reauth_item(item);
        if (!(0, reauth_recovery_service_1.is_reauth_recovered)(item.status, probe, firestore_1.Timestamp.now().toMillis())) {
            result.still_needs_reauth++;
            continue;
        }
        try {
            await mark_item_repaired(ctx, item);
            await refresh_repaired_item(ctx, item);
            result.repaired++;
        }
        catch (error) {
            console.error(`[${ctx.trace_id}] Self-heal repair failed for ${item.item_doc_id}:`, error);
        }
    }
    (0, observability_1.log_operation_success)(span, "system");
    return result;
}
//# sourceMappingURL=reauth_recovery.orchestrator.js.map