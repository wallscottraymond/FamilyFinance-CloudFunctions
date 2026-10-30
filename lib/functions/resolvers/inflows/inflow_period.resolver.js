"use strict";
/**
 * Inflow Period Resolver
 *
 * Resolves dependencies needed for inflow period generation.
 * Fetches source periods and inflow data.
 *
 * @module resolvers/inflows/inflow_period
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_inflow_period_dependencies = resolve_inflow_period_dependencies;
exports.resolve_inflow_period_dependencies_from_doc = resolve_inflow_period_dependencies_from_doc;
const generation_source_periods_resolver_1 = require("../periods/generation_source_periods.resolver");
const types_1 = require("../../types");
const repositories_1 = require("../../repositories");
/**
 * Maps inflow entity from repo to domain format.
 */
function map_inflow_to_domain(inflow) {
    var _a, _b;
    return {
        id: inflow.id,
        owner_id: inflow.user_id,
        created_by: inflow.user_id, // Simplified - repo doesn't track created_by
        group_id: (_a = inflow.group_ids[0]) !== null && _a !== void 0 ? _a : null,
        group_ids: inflow.group_ids,
        plaid_item_id: inflow.plaid_item_id,
        account_id: inflow.account_id,
        // The user's expected amount wins, as on the period page (Code-Health-Review M4-M2 / M1-M5).
        average_amount: (_b = inflow.expected_amount_override) !== null && _b !== void 0 ? _b : inflow.average_amount,
        currency: inflow.currency,
        description: inflow.description,
        payer_name: inflow.payer_name,
        user_custom_name: inflow.user_custom_name,
        frequency: inflow.frequency,
        first_date: inflow.first_date,
        last_date: inflow.last_date,
        predicted_next_date: inflow.predicted_next_date,
        plaid_primary_category: inflow.plaid_primary_category,
        plaid_detailed_category: inflow.plaid_detailed_category,
        internal_primary_category: inflow.internal_primary_category,
        internal_detailed_category: inflow.internal_detailed_category,
        income_type: inflow.income_type,
        is_active: inflow.is_active,
        is_hidden: inflow.is_hidden,
        source: inflow.source,
        tags: inflow.tags,
        rules: inflow.rules,
        transaction_ids: inflow.transaction_ids,
    };
}
/**
 * Resolve dependencies for inflow period generation.
 *
 * Fetches:
 * 1. The inflow document
 * 2. Source periods within the date range
 *
 * @param ctx - Trace context for logging
 * @param input - Resolution input with inflow ID and date range
 * @returns Dependencies needed for period generation
 */
async function resolve_inflow_period_dependencies(ctx, input) {
    var _a, _b, _c;
    console.log(`[${ctx.trace_id}] resolve_inflow_period_dependencies: inflow_id=${input.inflow_id}`);
    // 1. Get the inflow document
    const inflow = await repositories_1.inflow_repo.get_by_id(ctx, input.inflow_id);
    if (!inflow) {
        throw new Error(`Inflow not found: ${input.inflow_id}`);
    }
    if (!inflow.is_active) {
        throw new Error(`Inflow is not active: ${input.inflow_id}`);
    }
    // 2. Calculate date range for period generation
    const start_date = (_a = input.start_date) !== null && _a !== void 0 ? _a : inflow.first_date.toDate();
    const end_date = (_b = input.end_date) !== null && _b !== void 0 ? _b : new Date();
    if (!input.end_date) {
        end_date.setMonth(end_date.getMonth() + 12); // 12 months forward
    }
    console.log(`[${ctx.trace_id}] resolve_inflow_period_dependencies: date range ` +
        `${start_date.toISOString().split("T")[0]} to ${end_date.toISOString().split("T")[0]}`);
    // 3. Query source periods within the date range
    const periods = await (0, generation_source_periods_resolver_1.get_generation_source_periods)(ctx, start_date, end_date, {
        source: (_c = inflow.source) !== null && _c !== void 0 ? _c : "plaid",
        explicit_start: !!input.start_date,
    });
    const source_periods = periods.map((p) => ({
        id: p.id,
        period_id: p.period_id,
        type: p.period_type,
        start_date: p.start_date,
        end_date: p.end_date,
    }));
    console.log(`[${ctx.trace_id}] resolve_inflow_period_dependencies: found ${source_periods.length} source periods`);
    // 4. Return dependencies
    return {
        inflow: map_inflow_to_domain(inflow),
        source_periods,
        dependency_result: (0, types_1.no_dependencies)(), // Period generation doesn't affect other entities
    };
}
/**
 * Resolve inflow directly from Firestore document data.
 *
 * Used by triggers that have the document data already.
 * Avoids an extra read.
 *
 * @param ctx - Trace context
 * @param inflow_id - Inflow document ID
 * @param inflow_data - Raw Firestore document data (camelCase)
 * @param options - Optional date range overrides
 */
async function resolve_inflow_period_dependencies_from_doc(ctx, inflow_id, inflow_data, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y;
    console.log(`[${ctx.trace_id}] resolve_inflow_period_dependencies_from_doc: inflow_id=${inflow_id}`);
    // Map camelCase Firestore doc to snake_case domain format
    /* eslint-disable @typescript-eslint/naming-convention */
    const first_date = inflow_data.firstDate;
    const last_date = inflow_data.lastDate;
    const predicted_next_date = inflow_data.predictedNextDate;
    const inflow = {
        id: inflow_id,
        owner_id: (_a = inflow_data.ownerId) !== null && _a !== void 0 ? _a : inflow_data.userId,
        created_by: (_b = inflow_data.createdBy) !== null && _b !== void 0 ? _b : inflow_data.ownerId,
        group_id: (_c = inflow_data.groupId) !== null && _c !== void 0 ? _c : null,
        group_ids: (_d = inflow_data.groupIds) !== null && _d !== void 0 ? _d : (inflow_data.groupId ? [inflow_data.groupId] : []),
        plaid_item_id: inflow_data.plaidItemId,
        account_id: inflow_data.accountId,
        average_amount: (_e = inflow_data.expectedAmountOverride) !== null && _e !== void 0 ? _e : inflow_data.averageAmount,
        currency: (_f = inflow_data.currency) !== null && _f !== void 0 ? _f : "USD",
        description: (_g = inflow_data.description) !== null && _g !== void 0 ? _g : null,
        payer_name: (_j = (_h = inflow_data.merchantName) !== null && _h !== void 0 ? _h : inflow_data.payerName) !== null && _j !== void 0 ? _j : null,
        user_custom_name: (_k = inflow_data.userCustomName) !== null && _k !== void 0 ? _k : null,
        frequency: inflow_data.frequency,
        first_date,
        last_date,
        predicted_next_date,
        plaid_primary_category: (_l = inflow_data.plaidPrimaryCategory) !== null && _l !== void 0 ? _l : "INCOME",
        plaid_detailed_category: (_m = inflow_data.plaidDetailedCategory) !== null && _m !== void 0 ? _m : "",
        internal_primary_category: (_o = inflow_data.internalPrimaryCategory) !== null && _o !== void 0 ? _o : null,
        internal_detailed_category: (_p = inflow_data.internalDetailedCategory) !== null && _p !== void 0 ? _p : null,
        income_type: (_q = inflow_data.incomeType) !== null && _q !== void 0 ? _q : "other",
        is_active: (_r = inflow_data.isActive) !== null && _r !== void 0 ? _r : true,
        is_hidden: (_s = inflow_data.isHidden) !== null && _s !== void 0 ? _s : false,
        source: (_t = inflow_data.source) !== null && _t !== void 0 ? _t : "plaid",
        tags: (_u = inflow_data.tags) !== null && _u !== void 0 ? _u : [],
        rules: (_v = inflow_data.rules) !== null && _v !== void 0 ? _v : [],
        transaction_ids: (_w = inflow_data.transactionIds) !== null && _w !== void 0 ? _w : [],
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    // Check if active
    if (!inflow.is_active) {
        throw new Error(`Inflow is not active: ${inflow_id}`);
    }
    // Calculate date range
    const start_date = (_x = options === null || options === void 0 ? void 0 : options.start_date) !== null && _x !== void 0 ? _x : first_date.toDate();
    const end_date = (_y = options === null || options === void 0 ? void 0 : options.end_date) !== null && _y !== void 0 ? _y : new Date();
    if (!(options === null || options === void 0 ? void 0 : options.end_date)) {
        end_date.setMonth(end_date.getMonth() + 12);
    }
    console.log(`[${ctx.trace_id}] resolve_inflow_period_dependencies_from_doc: date range ` +
        `${start_date.toISOString().split("T")[0]} to ${end_date.toISOString().split("T")[0]}`);
    // Query source periods
    const periods = await (0, generation_source_periods_resolver_1.get_generation_source_periods)(ctx, start_date, end_date, {
        source: inflow.source,
        explicit_start: !!(options === null || options === void 0 ? void 0 : options.start_date),
    });
    const source_periods = periods.map((p) => ({
        id: p.id,
        period_id: p.period_id,
        type: p.period_type,
        start_date: p.start_date,
        end_date: p.end_date,
    }));
    console.log(`[${ctx.trace_id}] resolve_inflow_period_dependencies_from_doc: found ${source_periods.length} source periods`);
    return {
        inflow,
        source_periods,
        dependency_result: (0, types_1.no_dependencies)(),
    };
}
//# sourceMappingURL=inflow_period.resolver.js.map