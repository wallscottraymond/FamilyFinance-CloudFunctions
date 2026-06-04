"use strict";
/**
 * Recurring Sync Resolver
 *
 * Gathers dependencies for the recurring sync orchestrator.
 * - Fetches plaid_item and decrypts access token
 * - Gets user context (family, currency, groups)
 * - Fetches existing manual inflows/outflows for merge detection
 * - Identifies affected cashflow projections
 *
 * @module resolvers/plaid/recurring_sync
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_recurring_sync_dependencies = resolve_recurring_sync_dependencies;
exports.resolve_webhook_recurring_sync_dependencies = resolve_webhook_recurring_sync_dependencies;
exports.has_potential_merges = has_potential_merges;
exports.get_stale_candidates = get_stale_candidates;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../types");
const encryption_1 = require("../../../utils/encryption");
const repositories_1 = require("../../repositories");
// ============================================================================
// Resolver Function
// ============================================================================
/**
 * Resolves dependencies needed for the recurring sync orchestrator.
 *
 * This resolver:
 * 1. Fetches the plaid_item by doc ID
 * 2. Decrypts the access token
 * 3. Gets user context (family, currency, groups)
 * 4. Fetches existing inflows for merge detection
 * 5. Fetches existing outflows for merge detection
 * 6. Identifies affected cashflow projections
 *
 * @param ctx - Trace context
 * @param input - Recurring sync input
 * @returns Dependencies for the orchestrator, or null if not found
 */
async function resolve_recurring_sync_dependencies(ctx, input) {
    var _a;
    const db = (0, firestore_1.getFirestore)();
    // Step 1: Fetch plaid_item by document ID
    const item_doc = await db.collection("plaid_items").doc(input.item_id).get();
    if (!item_doc.exists) {
        console.error(`[${ctx.trace_id}] Plaid item not found: ${input.item_id}`);
        return null;
    }
    const item_data = item_doc.data();
    // Verify user ownership
    if (item_data.userId !== input.user_id) {
        console.error(`[${ctx.trace_id}] User ${input.user_id} does not own item ${input.item_id}`);
        return null;
    }
    // Check if item is active
    if (!item_data.isActive) {
        console.error(`[${ctx.trace_id}] Plaid item ${input.item_id} is not active`);
        return null;
    }
    // Step 2: Decrypt access token
    const encrypted_token = item_data.accessToken;
    if (!encrypted_token) {
        console.error(`[${ctx.trace_id}] Plaid item ${input.item_id} has no access token`);
        return null;
    }
    let access_token;
    try {
        access_token = (0, encryption_1.decryptAccessToken)(encrypted_token);
    }
    catch (error) {
        console.error(`[${ctx.trace_id}] Failed to decrypt access token for item ${input.item_id}:`, error);
        return null;
    }
    // Step 3: Get user context
    const user_context = await resolve_user_context(db, input.user_id, item_data.groupIds || []);
    // Step 4: Fetch existing inflows for this user
    const all_inflows = await repositories_1.inflow_repo.get_by_user_id(ctx, input.user_id, {
        include_deleted: false,
    });
    // Separate manual and Plaid inflows
    const existing_manual_inflows = [];
    const existing_plaid_inflow_ids = new Set();
    for (const inflow of all_inflows) {
        if (inflow.source === "manual") {
            existing_manual_inflows.push({
                id: inflow.id,
                payer_name: inflow.payer_name,
                description: inflow.description,
                average_amount: inflow.average_amount,
                frequency: inflow.frequency,
                source: inflow.source,
                is_active: inflow.is_active,
                plaid_stream_id: inflow.plaid_stream_id,
            });
        }
        else {
            existing_plaid_inflow_ids.add(inflow.id);
        }
    }
    // Step 5: Fetch existing outflows for this user
    const all_outflows = await repositories_1.outflow_repo.get_by_user_id(ctx, input.user_id, {
        include_deleted: false,
    });
    // Separate manual and Plaid outflows
    const existing_manual_outflows = [];
    const existing_plaid_outflow_ids = new Set();
    for (const outflow of all_outflows) {
        if (outflow.source === "manual") {
            existing_manual_outflows.push({
                id: outflow.id,
                merchant_name: outflow.merchant_name,
                description: outflow.description,
                average_amount: outflow.average_amount,
                frequency: outflow.frequency,
                source: outflow.source,
                is_active: outflow.is_active,
                plaid_stream_id: outflow.plaid_stream_id,
            });
        }
        else {
            existing_plaid_outflow_ids.add(outflow.id);
        }
    }
    // Step 6: Identify affected cashflow projections
    const dependency_result = await resolve_affected_cashflow_projections(db, input.user_id, user_context.family_id);
    console.log(`[${ctx.trace_id}] Resolved recurring sync dependencies: ` +
        `item=${input.item_id}, ` +
        `manual_inflows=${existing_manual_inflows.length}, ` +
        `manual_outflows=${existing_manual_outflows.length}, ` +
        `plaid_inflows=${existing_plaid_inflow_ids.size}, ` +
        `plaid_outflows=${existing_plaid_outflow_ids.size}, ` +
        `affected_projections=${dependency_result.affected_entities.length}`);
    return {
        plaid_item: {
            doc_id: item_doc.id,
            plaid_item_id: item_data.plaidItemId,
            access_token,
            user_id: input.user_id,
            institution_id: item_data.institutionId || "",
            institution_name: item_data.institutionName || "Unknown Institution",
            last_recurring_sync: ((_a = item_data.lastRecurringSyncAt) === null || _a === void 0 ? void 0 : _a.toDate()) || null,
        },
        user_context,
        existing_manual_inflows,
        existing_manual_outflows,
        existing_plaid_inflow_ids,
        existing_plaid_outflow_ids,
        dependency_result,
    };
}
/**
 * Resolves dependencies for webhook-triggered recurring sync.
 *
 * Looks up item by Plaid item ID instead of doc ID.
 *
 * @param ctx - Trace context
 * @param plaid_item_id - Plaid item ID (from webhook)
 * @returns Dependencies for the orchestrator, or null if item not found
 */
async function resolve_webhook_recurring_sync_dependencies(ctx, plaid_item_id) {
    const db = (0, firestore_1.getFirestore)();
    // Find item by Plaid item ID
    const items_snapshot = await db.collection("plaid_items")
        .where("plaidItemId", "==", plaid_item_id)
        .where("isActive", "==", true)
        .limit(1)
        .get();
    if (items_snapshot.empty) {
        console.error(`[${ctx.trace_id}] No active plaid_item found for Plaid ID: ${plaid_item_id}`);
        return null;
    }
    const item_doc = items_snapshot.docs[0];
    const item_data = item_doc.data();
    const user_id = item_data.userId;
    // Use the standard resolver with doc ID
    return resolve_recurring_sync_dependencies(ctx, {
        item_id: item_doc.id,
        user_id,
    });
}
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Resolves user context for recurring sync.
 */
async function resolve_user_context(db, user_id, item_group_ids) {
    var _a;
    let family_id = null;
    let currency = "USD";
    let group_ids = [...item_group_ids];
    const user_doc = await db.collection("users").doc(user_id).get();
    if (user_doc.exists) {
        const user_data = user_doc.data();
        family_id = user_data.familyId || null;
        // Get family settings for currency
        if (family_id) {
            const family_doc = await db.collection("families").doc(family_id).get();
            if (family_doc.exists) {
                const family_data = family_doc.data();
                currency = ((_a = family_data.settings) === null || _a === void 0 ? void 0 : _a.currency) || "USD";
                // Add family group to group_ids if not already present
                if (!group_ids.includes(family_id)) {
                    group_ids = [...group_ids, family_id];
                }
            }
        }
    }
    return {
        family_id,
        currency,
        group_ids,
    };
}
/**
 * Identifies cashflow projections that will be affected by recurring sync.
 *
 * When recurring items change, cashflow projections need recalculation.
 */
async function resolve_affected_cashflow_projections(db, user_id, family_id) {
    // Find cashflow projections for this user/family
    const affected_ids = [];
    // User's personal cashflow projections
    const user_projections = await db.collection("cashflow_projections")
        .where("userId", "==", user_id)
        .where("isActive", "==", true)
        .get();
    user_projections.docs.forEach(doc => {
        affected_ids.push(doc.id);
    });
    // Family cashflow projections (if in a family)
    if (family_id) {
        const family_projections = await db.collection("cashflow_projections")
            .where("familyId", "==", family_id)
            .where("isActive", "==", true)
            .get();
        family_projections.docs.forEach(doc => {
            if (!affected_ids.includes(doc.id)) {
                affected_ids.push(doc.id);
            }
        });
    }
    // Also mark user_summary as affected (for monthly totals)
    affected_ids.push(`user_summary:${user_id}`);
    if (affected_ids.length === 0) {
        return (0, types_1.no_dependencies)();
    }
    return (0, types_1.batch_dependencies)(affected_ids, "medium");
}
/**
 * Resolves merge suggestions for new recurring items.
 *
 * This is a convenience function that combines the resolver data
 * with domain service functions for merge detection.
 */
function has_potential_merges(dependencies) {
    return (dependencies.existing_manual_inflows.length > 0 ||
        dependencies.existing_manual_outflows.length > 0);
}
/**
 * Gets IDs of items that need stale detection.
 *
 * Stale detection: If a Plaid stream was previously synced but is no longer
 * returned by Plaid, it may have ended and should be marked inactive.
 */
function get_stale_candidates(dependencies, current_plaid_inflow_ids, current_plaid_outflow_ids) {
    // Inflows that were previously synced but not in current response
    const stale_inflow_ids = Array.from(dependencies.existing_plaid_inflow_ids)
        .filter(id => !current_plaid_inflow_ids.includes(id));
    // Outflows that were previously synced but not in current response
    const stale_outflow_ids = Array.from(dependencies.existing_plaid_outflow_ids)
        .filter(id => !current_plaid_outflow_ids.includes(id));
    return {
        stale_inflow_ids,
        stale_outflow_ids,
    };
}
//# sourceMappingURL=recurring_sync.resolver.js.map