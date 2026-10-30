"use strict";
/**
 * Outflow Period Resolver
 *
 * Resolves dependencies needed for outflow period generation.
 * Fetches source periods and outflow data.
 *
 * @module resolvers/outflows/outflow_period
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_outflow_period_dependencies = resolve_outflow_period_dependencies;
exports.resolve_outflow_period_dependencies_from_doc = resolve_outflow_period_dependencies_from_doc;
const generation_source_periods_resolver_1 = require("../periods/generation_source_periods.resolver");
const types_1 = require("../../types");
const repositories_1 = require("../../repositories");
/**
 * Maps outflow entity from repo to domain format.
 */
function map_outflow_to_domain(outflow) {
    var _a, _b;
    return {
        id: outflow.id,
        owner_id: outflow.user_id,
        created_by: outflow.user_id, // Simplified - repo doesn't track created_by
        group_id: (_a = outflow.group_ids[0]) !== null && _a !== void 0 ? _a : null,
        group_ids: outflow.group_ids,
        plaid_item_id: outflow.plaid_item_id,
        account_id: outflow.account_id,
        // The user's expected amount wins, as on the period page (Code-Health-Review M4-M2 / M1-M5).
        average_amount: (_b = outflow.expected_amount_override) !== null && _b !== void 0 ? _b : outflow.average_amount,
        last_amount: outflow.last_amount,
        currency: outflow.currency,
        description: outflow.description,
        merchant_name: outflow.merchant_name,
        user_custom_name: outflow.user_custom_name,
        frequency: outflow.frequency,
        first_date: outflow.first_date,
        last_date: outflow.last_date,
        predicted_next_date: outflow.predicted_next_date,
        plaid_primary_category: outflow.plaid_primary_category,
        plaid_detailed_category: outflow.plaid_detailed_category,
        internal_primary_category: outflow.internal_primary_category,
        internal_detailed_category: outflow.internal_detailed_category,
        expense_type: outflow.expense_type,
        is_essential: outflow.is_essential,
        is_active: outflow.is_active,
        is_hidden: outflow.is_hidden,
        source: outflow.source,
        tags: outflow.tags,
        rules: outflow.rules,
        transaction_ids: outflow.transaction_ids,
    };
}
/**
 * Resolve dependencies for outflow period generation.
 *
 * Fetches:
 * 1. The outflow document
 * 2. Source periods within the date range
 *
 * @param ctx - Trace context for logging
 * @param input - Resolution input with outflow ID and date range
 * @returns Dependencies needed for period generation
 */
async function resolve_outflow_period_dependencies(ctx, input) {
    var _a, _b, _c;
    console.log(`[${ctx.trace_id}] resolve_outflow_period_dependencies: outflow_id=${input.outflow_id}`);
    // 1. Get the outflow document
    const outflow = await repositories_1.outflow_repo.get_by_id(ctx, input.outflow_id);
    if (!outflow) {
        throw new Error(`Outflow not found: ${input.outflow_id}`);
    }
    // Note: is_active validation is done in domain layer, not resolver
    // Resolver only does data lookups, not business logic validation
    // 2. Calculate date range for period generation
    const start_date = (_a = input.start_date) !== null && _a !== void 0 ? _a : outflow.first_date.toDate();
    const end_date = (_b = input.end_date) !== null && _b !== void 0 ? _b : new Date();
    if (!input.end_date) {
        end_date.setMonth(end_date.getMonth() + 15); // 15 months forward (like legacy)
    }
    console.log(`[${ctx.trace_id}] resolve_outflow_period_dependencies: date range ` +
        `${start_date.toISOString().split("T")[0]} to ${end_date.toISOString().split("T")[0]}`);
    // 3. Query source periods within the date range
    const periods = await (0, generation_source_periods_resolver_1.get_generation_source_periods)(ctx, start_date, end_date, {
        source: (_c = outflow.source) !== null && _c !== void 0 ? _c : "plaid",
        explicit_start: !!input.start_date,
    });
    const source_periods = periods.map((p) => ({
        id: p.id,
        period_id: p.period_id,
        type: p.period_type,
        start_date: p.start_date,
        end_date: p.end_date,
    }));
    console.log(`[${ctx.trace_id}] resolve_outflow_period_dependencies: found ${source_periods.length} source periods`);
    // 4. Return dependencies
    return {
        outflow: map_outflow_to_domain(outflow),
        source_periods,
        dependency_result: (0, types_1.no_dependencies)(), // Period generation doesn't affect other entities
    };
}
/**
 * Resolve outflow directly from Firestore document data.
 *
 * Used by triggers that have the document data already.
 * Avoids an extra read.
 *
 * @param ctx - Trace context
 * @param outflow_id - Outflow document ID
 * @param outflow_data - Raw Firestore document data (camelCase)
 * @param options - Optional date range overrides
 */
async function resolve_outflow_period_dependencies_from_doc(ctx, outflow_id, outflow_data, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z;
    console.log(`[${ctx.trace_id}] resolve_outflow_period_dependencies_from_doc: outflow_id=${outflow_id}`);
    // ===== DIAGNOSTIC LOGGING =====
    console.log(`[${ctx.trace_id}] DIAGNOSTIC - Received outflow_data keys: ${Object.keys(outflow_data).join(", ")}`);
    console.log(`[${ctx.trace_id}] DIAGNOSTIC - outflow_data.ownerId: ${outflow_data.ownerId}, ` +
        `outflow_data.userId: ${outflow_data.userId}, ` +
        `outflow_data.isActive: ${outflow_data.isActive}, ` +
        `outflow_data.frequency: ${outflow_data.frequency}, ` +
        `outflow_data.averageAmount: ${outflow_data.averageAmount}`);
    // ===== END DIAGNOSTIC =====
    // Map camelCase Firestore doc to snake_case domain format
    /* eslint-disable @typescript-eslint/naming-convention */
    const first_date = outflow_data.firstDate;
    const last_date = outflow_data.lastDate;
    const predicted_next_date = outflow_data.predictedNextDate;
    const outflow = {
        id: outflow_id,
        owner_id: (_a = outflow_data.ownerId) !== null && _a !== void 0 ? _a : outflow_data.userId,
        created_by: (_b = outflow_data.createdBy) !== null && _b !== void 0 ? _b : outflow_data.ownerId,
        group_id: (_c = outflow_data.groupId) !== null && _c !== void 0 ? _c : null,
        group_ids: (_d = outflow_data.groupIds) !== null && _d !== void 0 ? _d : (outflow_data.groupId ? [outflow_data.groupId] : []),
        plaid_item_id: outflow_data.plaidItemId,
        account_id: outflow_data.accountId,
        average_amount: (_e = outflow_data.expectedAmountOverride) !== null && _e !== void 0 ? _e : outflow_data.averageAmount,
        last_amount: (_f = outflow_data.lastAmount) !== null && _f !== void 0 ? _f : outflow_data.averageAmount,
        currency: (_g = outflow_data.currency) !== null && _g !== void 0 ? _g : "USD",
        description: (_h = outflow_data.description) !== null && _h !== void 0 ? _h : null,
        merchant_name: (_j = outflow_data.merchantName) !== null && _j !== void 0 ? _j : null,
        user_custom_name: (_k = outflow_data.userCustomName) !== null && _k !== void 0 ? _k : null,
        frequency: outflow_data.frequency,
        first_date,
        last_date,
        predicted_next_date,
        plaid_primary_category: (_l = outflow_data.plaidPrimaryCategory) !== null && _l !== void 0 ? _l : "OTHER",
        plaid_detailed_category: (_m = outflow_data.plaidDetailedCategory) !== null && _m !== void 0 ? _m : "",
        internal_primary_category: (_o = outflow_data.internalPrimaryCategory) !== null && _o !== void 0 ? _o : null,
        internal_detailed_category: (_p = outflow_data.internalDetailedCategory) !== null && _p !== void 0 ? _p : null,
        expense_type: (_q = outflow_data.expenseType) !== null && _q !== void 0 ? _q : "other",
        is_essential: (_r = outflow_data.isEssential) !== null && _r !== void 0 ? _r : false,
        is_active: (_s = outflow_data.isActive) !== null && _s !== void 0 ? _s : true,
        is_hidden: (_t = outflow_data.isHidden) !== null && _t !== void 0 ? _t : false,
        source: (_u = outflow_data.source) !== null && _u !== void 0 ? _u : "plaid",
        tags: (_v = outflow_data.tags) !== null && _v !== void 0 ? _v : [],
        rules: (_w = outflow_data.rules) !== null && _w !== void 0 ? _w : [],
        transaction_ids: (_x = outflow_data.transactionIds) !== null && _x !== void 0 ? _x : [],
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    // ===== DIAGNOSTIC LOGGING =====
    console.log(`[${ctx.trace_id}] DIAGNOSTIC - Mapped outflow: ` +
        `id=${outflow.id}, ` +
        `owner_id=${outflow.owner_id}, ` +
        `is_active=${outflow.is_active}, ` +
        `frequency=${outflow.frequency}, ` +
        `average_amount=${outflow.average_amount}`);
    // ===== END DIAGNOSTIC =====
    // Note: is_active validation is done in domain layer, not resolver
    // Resolver only does data lookups, not business logic validation
    // Calculate date range
    const start_date = (_y = options === null || options === void 0 ? void 0 : options.start_date) !== null && _y !== void 0 ? _y : first_date.toDate();
    const end_date = (_z = options === null || options === void 0 ? void 0 : options.end_date) !== null && _z !== void 0 ? _z : new Date();
    if (!(options === null || options === void 0 ? void 0 : options.end_date)) {
        end_date.setMonth(end_date.getMonth() + 15); // 15 months forward
    }
    console.log(`[${ctx.trace_id}] resolve_outflow_period_dependencies_from_doc: date range ` +
        `${start_date.toISOString().split("T")[0]} to ${end_date.toISOString().split("T")[0]}`);
    // Query source periods
    const periods = await (0, generation_source_periods_resolver_1.get_generation_source_periods)(ctx, start_date, end_date, {
        source: outflow.source,
        explicit_start: !!(options === null || options === void 0 ? void 0 : options.start_date),
    });
    const source_periods = periods.map((p) => ({
        id: p.id,
        period_id: p.period_id,
        type: p.period_type,
        start_date: p.start_date,
        end_date: p.end_date,
    }));
    console.log(`[${ctx.trace_id}] resolve_outflow_period_dependencies_from_doc: found ${source_periods.length} source periods`);
    return {
        outflow,
        source_periods,
        dependency_result: (0, types_1.no_dependencies)(),
    };
}
//# sourceMappingURL=outflow_period.resolver.js.map