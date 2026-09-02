"use strict";
/**
 * User Summary Resolver
 *
 * Resolves dependencies needed for user period summary computation.
 * Fetches all resource periods (outflows, budgets, inflows) for a given period.
 *
 * READ-ONLY: No business logic, no mutations.
 *
 * @module resolvers/summaries/user_summary
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_user_summary_dependencies = resolve_user_summary_dependencies;
exports.batch_resolve_user_summary_dependencies = batch_resolve_user_summary_dependencies;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../types");
const budget_repo_1 = require("../../repositories/budget.repo");
/**
 * Resolve dependencies for user period summary computation.
 *
 * Fetches:
 * 1. The source period document
 * 2. All outflow_periods for the user and period
 * 3. All budget_periods for the user and period
 * 4. All inflow_periods for the user and period
 *
 * READ-ONLY: Only queries data, no mutations.
 *
 * @param ctx - Trace context for logging
 * @param input - Resolution input with user, period type, and source period
 * @returns Dependencies needed for summary computation
 */
async function resolve_user_summary_dependencies(ctx, input) {
    var _a, _b, _c;
    const { user_id, period_type, source_period_id } = input;
    console.log(`[${ctx.trace_id}] resolve_user_summary_dependencies: ` +
        `user=${user_id}, period=${source_period_id}, type=${period_type}`);
    const db = (0, firestore_1.getFirestore)();
    // 1. Fetch source period
    const source_period_doc = await db
        .collection("source_periods")
        .doc(source_period_id)
        .get();
    if (!source_period_doc.exists) {
        throw new Error(`Source period not found: ${source_period_id}`);
    }
    const source_period = source_period_doc.data();
    console.log(`[${ctx.trace_id}] resolve_user_summary_dependencies: found source period ` +
        `type=${source_period.type}, year=${source_period.year}`);
    // 2. Fetch all resource periods in parallel
    /* eslint-disable @typescript-eslint/naming-convention */
    const [outflow_snapshot, budget_snapshot, inflow_snapshot, budgets] = await Promise.all([
        // Outflow periods
        db
            .collection("outflow_periods")
            .where("ownerId", "==", user_id)
            .where("sourcePeriodId", "==", source_period_id)
            .where("isActive", "==", true)
            .get(),
        // Budget periods
        db
            .collection("budget_periods")
            .where("userId", "==", user_id)
            .where("sourcePeriodId", "==", source_period_id)
            .where("periodType", "==", period_type)
            .where("isActive", "==", true)
            .get(),
        // Inflow periods
        db
            .collection("inflow_periods")
            .where("ownerId", "==", user_id)
            .where("sourcePeriodId", "==", source_period_id)
            .where("isActive", "==", true)
            .get(),
        // Budgets — to collapse per-lens Everything-Else budgets to ONE canonical EE.
        budget_repo_1.budget_repo.get_by_user_id(ctx, user_id),
    ]);
    /* eslint-enable @typescript-eslint/naming-convention */
    // Collapse the per-lens Everything-Else budgets to ONE canonical EE (the monthly EE,
    // else any EE) — MIRRORS the derive path (`period_derivation.resolver` `canonical_ee_id`).
    // By the Prime/Non-Prime model EVERY budget (incl. all 3 per-lens EE budgets) has a period
    // in every cadence, so without this a monthly summary lists all 3 EE budgets, and the
    // materialized-backed period page shows weekly + bi-monthly EE tiles under monthly.
    const ee_ids = budgets.filter((b) => b.is_system_everything_else).map((b) => b.id);
    const monthly_ee_id = (_b = (_a = budgets.find((b) => b.is_system_everything_else && b.period === "monthly")) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null;
    const canonical_ee_id = (_c = monthly_ee_id !== null && monthly_ee_id !== void 0 ? monthly_ee_id : ee_ids[0]) !== null && _c !== void 0 ? _c : null;
    const excluded_ee_ids = new Set(ee_ids.filter((id) => id !== canonical_ee_id));
    // 3. Map snapshots to typed arrays
    const outflow_periods = outflow_snapshot.docs.map((doc) => doc.data());
    const budget_periods = budget_snapshot.docs
        .map((doc) => doc.data())
        .filter((bp) => !excluded_ee_ids.has(bp.budgetId));
    const inflow_periods = inflow_snapshot.docs.map((doc) => doc.data());
    console.log(`[${ctx.trace_id}] resolve_user_summary_dependencies: found resources - ` +
        `outflows=${outflow_periods.length}, ` +
        `budgets=${budget_periods.length}, ` +
        `inflows=${inflow_periods.length}`);
    // 4. Return dependencies
    return {
        source_period,
        outflow_periods,
        budget_periods,
        inflow_periods,
        dependency_result: (0, types_1.no_dependencies)(), // Summary computation doesn't affect other entities
    };
}
/**
 * Batch resolve dependencies for multiple periods.
 *
 * Efficiently fetches dependencies for multiple source periods at once.
 * Used when updating summaries for multiple periods (e.g., after outflow creation).
 *
 * @param ctx - Trace context for logging
 * @param user_id - The user ID
 * @param period_type - The period type
 * @param source_period_ids - Array of source period IDs
 * @returns Map of source_period_id to dependencies
 */
async function batch_resolve_user_summary_dependencies(ctx, user_id, period_type, source_period_ids) {
    console.log(`[${ctx.trace_id}] batch_resolve_user_summary_dependencies: ` +
        `user=${user_id}, type=${period_type}, periods=${source_period_ids.length}`);
    const results = new Map();
    // Process each period (could be optimized with IN queries if needed)
    await Promise.all(source_period_ids.map(async (source_period_id) => {
        try {
            const deps = await resolve_user_summary_dependencies(ctx, {
                user_id,
                period_type,
                source_period_id,
            });
            results.set(source_period_id, deps);
        }
        catch (error) {
            console.error(`[${ctx.trace_id}] batch_resolve_user_summary_dependencies: ` +
                `error for period ${source_period_id}:`, error);
            // Skip failed periods rather than failing the entire batch
        }
    }));
    console.log(`[${ctx.trace_id}] batch_resolve_user_summary_dependencies: ` +
        `resolved ${results.size}/${source_period_ids.length} periods`);
    return results;
}
//# sourceMappingURL=user_summary.resolver.js.map