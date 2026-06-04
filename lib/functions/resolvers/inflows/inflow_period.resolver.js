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
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../types");
const repositories_1 = require("../../repositories");
/**
 * Maps inflow entity from repo to domain format.
 */
function map_inflow_to_domain(inflow) {
    var _a;
    return {
        id: inflow.id,
        owner_id: inflow.user_id,
        created_by: inflow.user_id, // Simplified - repo doesn't track created_by
        group_id: (_a = inflow.group_ids[0]) !== null && _a !== void 0 ? _a : null,
        group_ids: inflow.group_ids,
        plaid_item_id: inflow.plaid_item_id,
        account_id: inflow.account_id,
        average_amount: inflow.average_amount,
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
    var _a, _b;
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
    const db = (0, firestore_1.getFirestore)();
    /* eslint-disable @typescript-eslint/naming-convention */
    const snapshot = await db
        .collection("source_periods")
        .where("startDate", ">=", firestore_1.Timestamp.fromDate(start_date))
        .where("startDate", "<=", firestore_1.Timestamp.fromDate(end_date))
        .orderBy("startDate", "asc")
        .get();
    /* eslint-enable @typescript-eslint/naming-convention */
    const source_periods = snapshot.docs.map((doc) => {
        var _a;
        const data = doc.data();
        return {
            id: doc.id,
            period_id: (_a = data.periodId) !== null && _a !== void 0 ? _a : doc.id,
            type: data.type,
            start_date: data.startDate,
            end_date: data.endDate,
        };
    });
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x;
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
        average_amount: inflow_data.averageAmount,
        currency: (_e = inflow_data.currency) !== null && _e !== void 0 ? _e : "USD",
        description: (_f = inflow_data.description) !== null && _f !== void 0 ? _f : null,
        payer_name: (_h = (_g = inflow_data.merchantName) !== null && _g !== void 0 ? _g : inflow_data.payerName) !== null && _h !== void 0 ? _h : null,
        user_custom_name: (_j = inflow_data.userCustomName) !== null && _j !== void 0 ? _j : null,
        frequency: inflow_data.frequency,
        first_date,
        last_date,
        predicted_next_date,
        plaid_primary_category: (_k = inflow_data.plaidPrimaryCategory) !== null && _k !== void 0 ? _k : "INCOME",
        plaid_detailed_category: (_l = inflow_data.plaidDetailedCategory) !== null && _l !== void 0 ? _l : "",
        internal_primary_category: (_m = inflow_data.internalPrimaryCategory) !== null && _m !== void 0 ? _m : null,
        internal_detailed_category: (_o = inflow_data.internalDetailedCategory) !== null && _o !== void 0 ? _o : null,
        income_type: (_p = inflow_data.incomeType) !== null && _p !== void 0 ? _p : "other",
        is_active: (_q = inflow_data.isActive) !== null && _q !== void 0 ? _q : true,
        is_hidden: (_r = inflow_data.isHidden) !== null && _r !== void 0 ? _r : false,
        source: (_s = inflow_data.source) !== null && _s !== void 0 ? _s : "plaid",
        tags: (_t = inflow_data.tags) !== null && _t !== void 0 ? _t : [],
        rules: (_u = inflow_data.rules) !== null && _u !== void 0 ? _u : [],
        transaction_ids: (_v = inflow_data.transactionIds) !== null && _v !== void 0 ? _v : [],
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    // Check if active
    if (!inflow.is_active) {
        throw new Error(`Inflow is not active: ${inflow_id}`);
    }
    // Calculate date range
    const start_date = (_w = options === null || options === void 0 ? void 0 : options.start_date) !== null && _w !== void 0 ? _w : first_date.toDate();
    const end_date = (_x = options === null || options === void 0 ? void 0 : options.end_date) !== null && _x !== void 0 ? _x : new Date();
    if (!(options === null || options === void 0 ? void 0 : options.end_date)) {
        end_date.setMonth(end_date.getMonth() + 12);
    }
    console.log(`[${ctx.trace_id}] resolve_inflow_period_dependencies_from_doc: date range ` +
        `${start_date.toISOString().split("T")[0]} to ${end_date.toISOString().split("T")[0]}`);
    // Query source periods
    const db = (0, firestore_1.getFirestore)();
    /* eslint-disable @typescript-eslint/naming-convention */
    const snapshot = await db
        .collection("source_periods")
        .where("startDate", ">=", firestore_1.Timestamp.fromDate(start_date))
        .where("startDate", "<=", firestore_1.Timestamp.fromDate(end_date))
        .orderBy("startDate", "asc")
        .get();
    /* eslint-enable @typescript-eslint/naming-convention */
    const source_periods = snapshot.docs.map((doc) => {
        var _a;
        const data = doc.data();
        return {
            id: doc.id,
            period_id: (_a = data.periodId) !== null && _a !== void 0 ? _a : doc.id,
            type: data.type,
            start_date: data.startDate,
            end_date: data.endDate,
        };
    });
    console.log(`[${ctx.trace_id}] resolve_inflow_period_dependencies_from_doc: found ${source_periods.length} source periods`);
    return {
        inflow,
        source_periods,
        dependency_result: (0, types_1.no_dependencies)(),
    };
}
//# sourceMappingURL=inflow_period.resolver.js.map