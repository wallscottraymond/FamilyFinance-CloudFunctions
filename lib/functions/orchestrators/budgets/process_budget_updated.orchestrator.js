"use strict";
/**
 * Process Budget Updated (Cascade Job Handler)
 *
 * Runs asynchronously after a budget is updated. Performs:
 * 1. Category claims (added) — remove from prior owners.
 * 2. Category releases (removed) — return to Everything Else.
 * 3. Re-allocates existing periods IN PLACE when the amount changed (preserving
 *    per-period user data: notes, checklist, modified amounts, and historical
 *    periods).
 *
 * @module orchestrators/budgets/process_budget_updated
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.process_budget_updated_orchestrator = process_budget_updated_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const observability_1 = require("../../observability");
const budget_repo_1 = require("../../repositories/budget.repo");
const budget_period_repo_1 = require("../../repositories/budget_period.repo");
const source_period_repo_1 = require("../../repositories/source_period.repo");
const period_generation_service_1 = require("../../domain/budgets/period_generation.service");
const summaries_1 = require("../../orchestrators/summaries");
const job_queue_1 = require("../../infrastructure/job_queue");
const budget_rehome_resolver_1 = require("../../resolvers/budgets/budget_rehome.resolver");
/**
 * Processes the update cascade.
 */
async function process_budget_updated_orchestrator(ctx, payload) {
    var _a, _b;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "process_budget_updated");
    (0, observability_1.log_operation_start)(span, payload.user_id);
    // 1. Claims for added categories: remove from prior owners.
    const removals = new Map();
    for (const claim of payload.added_claims) {
        const source = (_a = claim.from_budget_id) !== null && _a !== void 0 ? _a : payload.everything_else_budget_id;
        if (!source || source === payload.budget_id) {
            continue;
        }
        const list = (_b = removals.get(source)) !== null && _b !== void 0 ? _b : [];
        list.push(claim.category_id);
        removals.set(source, list);
    }
    for (const [source_budget_id, category_ids] of removals) {
        await budget_repo_1.budget_repo.remove_category_ids(ctx, source_budget_id, category_ids, payload.user_id);
    }
    // 2. Releases: return removed categories to Everything Else.
    if (payload.released_category_ids.length > 0 &&
        payload.everything_else_budget_id) {
        await budget_repo_1.budget_repo.add_category_ids(ctx, payload.everything_else_budget_id, payload.released_category_ids, payload.user_id);
    }
    // 3. Re-allocate periods if the amount changed.
    if (payload.regenerate_periods) {
        await reallocate_periods(ctx, payload);
    }
    // 4. Propagate a renamed budget to its current+future periods.
    if (payload.name_changed) {
        await propagate_name(ctx, payload);
    }
    // 5. Re-home cascade: a category change moves splits between Everything Else
    //    and this budget. Re-run assignment for the candidate transactions (those
    //    currently on EE — may gain; or on this budget — may release) in range.
    await rehome_changed_categories(ctx, payload);
    (0, observability_1.log_operation_success)(span, payload.user_id);
}
/**
 * Re-assign transactions affected by a category add/remove so spend moves
 * Everything Else ⇄ this budget. No-op when no categories changed.
 */
async function rehome_changed_categories(ctx, payload) {
    const categories_changed = payload.added_claims.length > 0 || payload.released_category_ids.length > 0;
    const txn_ids = await (0, budget_rehome_resolver_1.resolve_updated_rehome_transaction_ids)(ctx, payload.user_id, payload.budget_id, payload.everything_else_budget_id, categories_changed, payload.start_ms, payload.generation_end_ms);
    for (const transaction_id of txn_ids) {
        await (0, job_queue_1.create_job)("assign_transaction", { user_id: payload.user_id, transaction_id }, { trace_id: ctx.trace_id });
    }
    if (txn_ids.length > 0) {
        console.log(`[${ctx.trace_id}] process_budget_updated: re-homed ${txn_ids.length} ` +
            `transactions for budget ${payload.budget_id}`);
    }
}
/**
 * Updates the denormalized budgetName on current+future periods after a rename
 * and recomputes their summaries. Historical periods are left unchanged.
 */
async function propagate_name(ctx, payload) {
    const existing = await budget_period_repo_1.budget_period_repo.get_by_budget_id(ctx, payload.budget_id);
    const cutoff = start_of_today_utc().toMillis();
    const ids = existing
        .filter((p) => p.end_date.toMillis() >= cutoff)
        .map((p) => p.id);
    if (ids.length === 0) {
        return;
    }
    await budget_period_repo_1.budget_period_repo.update_names(ctx, ids, payload.budget_name);
    try {
        await (0, summaries_1.enqueue_user_summary_updates_from_budget_periods)(ctx, payload.user_id, ids);
    }
    catch (summary_error) {
        console.error(`[${ctx.trace_id}] process_budget_updated: name summary update failed (non-fatal):`, summary_error);
    }
}
/**
 * Start of today (UTC midnight) — periods ending on/after this are re-allocated.
 */
function start_of_today_utc() {
    const now = new Date();
    return firestore_1.Timestamp.fromDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
}
/**
 * Re-allocates existing periods in place for the new amount, preserving
 * per-period user data and historical periods. Falls back to generating fresh
 * periods only if the budget has none yet (an anomaly — periods are created on
 * budget creation).
 */
async function reallocate_periods(ctx, payload) {
    var _a;
    const existing = await budget_period_repo_1.budget_period_repo.get_by_budget_id(ctx, payload.budget_id);
    if (existing.length === 0) {
        await generate_fresh_periods(ctx, payload);
        return;
    }
    const computed = (0, period_generation_service_1.compute_reallocated_periods)({
        new_amount: payload.amount,
        budget_cadence: payload.cadence,
        cutoff: start_of_today_utc(),
        periods: existing.map((p) => ({
            id: p.id,
            period_id: p.period_id,
            period_type: p.period_type,
            start_date: p.start_date,
            end_date: p.end_date,
            spent: p.spent,
            rolled_over_amount: p.rolled_over_amount,
            daily_rate: p.daily_rate,
        })),
    });
    const updates = (_a = computed.entities) !== null && _a !== void 0 ? _a : [];
    if (updates.length === 0) {
        return;
    }
    await budget_period_repo_1.budget_period_repo.update_allocations(ctx, updates);
    try {
        await (0, summaries_1.enqueue_user_summary_updates_from_budget_periods)(ctx, payload.user_id, updates.map((u) => u.id));
    }
    catch (summary_error) {
        console.error(`[${ctx.trace_id}] process_budget_updated: summary update failed (non-fatal):`, summary_error);
    }
}
/**
 * Generates periods from source periods (no existing periods to preserve).
 * Used only as a fallback when an amount-change update finds no periods.
 */
async function generate_fresh_periods(ctx, payload) {
    const anchor = firestore_1.Timestamp.fromMillis(payload.start_ms);
    const generation_end = firestore_1.Timestamp.fromMillis(payload.generation_end_ms);
    const source_periods = await source_period_repo_1.source_period_repo.get_overlapping(ctx, anchor, generation_end);
    if (source_periods.length === 0) {
        return;
    }
    const computed = (0, period_generation_service_1.compute_budget_periods)({
        budget_id: payload.budget_id,
        user_id: payload.user_id,
        group_ids: payload.group_ids,
        budget_amount: payload.amount,
        budget_cadence: payload.cadence,
        category_ids: payload.category_ids,
        source_periods: source_periods.map((sp) => ({
            id: sp.id,
            period_id: sp.period_id,
            period_type: sp.period_type,
            start_date: sp.start_date,
            end_date: sp.end_date,
        })),
        now: firestore_1.Timestamp.now(),
    });
    if (!computed.entities || computed.entities.length === 0) {
        return;
    }
    await budget_period_repo_1.budget_period_repo.save_batch(ctx, computed.entities, payload.budget_name);
    // Recompute user_summary documents for the freshly generated periods.
    const period_ids = computed.entities.map((p) => p.id);
    try {
        await (0, summaries_1.enqueue_user_summary_updates_from_budget_periods)(ctx, payload.user_id, period_ids);
    }
    catch (summary_error) {
        console.error(`[${ctx.trace_id}] process_budget_updated: summary update failed (non-fatal):`, summary_error);
    }
    // Write back the refreshed period-range metadata (legacy parity).
    const prime = computed.entities.filter((e) => e.period_type === payload.cadence);
    if (prime.length > 0) {
        try {
            await budget_repo_1.budget_repo.set_period_range(ctx, payload.budget_id, prime[0].period_id, prime[prime.length - 1].period_id, generation_end, payload.is_recurring, payload.user_id);
        }
        catch (range_error) {
            console.error(`[${ctx.trace_id}] process_budget_updated: period-range write-back failed (non-fatal):`, range_error);
        }
    }
}
//# sourceMappingURL=process_budget_updated.orchestrator.js.map