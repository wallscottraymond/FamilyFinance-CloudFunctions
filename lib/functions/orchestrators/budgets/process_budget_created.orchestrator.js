"use strict";
/**
 * Process Budget Created (Cascade Job Handler)
 *
 * Runs asynchronously after a budget is created. Performs the heavy work:
 * 1. Transfers claimed categories away from their previous owners.
 * 2. Generates budget periods from source periods.
 *
 * Reimplemented in the layered architecture (domain computes, repos persist) —
 * does not call the legacy category-transfer / period-generation utilities.
 *
 * @module orchestrators/budgets/process_budget_created
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.process_budget_created_orchestrator = process_budget_created_orchestrator;
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
 * Processes the create cascade.
 */
async function process_budget_created_orchestrator(ctx, payload) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "process_budget_created");
    (0, observability_1.log_operation_start)(span, payload.user_id);
    // 1. Apply category claims: remove each claimed category from its previous
    //    owner. Unassigned (null) categories fall to Everything Else if present.
    await apply_claims(ctx, payload.claims, payload.budget_id, payload.everything_else_budget_id, payload.user_id);
    // 2. Generate budget periods from source periods in the budget's range.
    await generate_periods(ctx, payload);
    // 3. Re-home cascade: existing transactions on Everything Else within this
    //    budget's range may now match it (it owns the claimed categories) — re-run
    //    assignment so their spend moves EE → this budget. Idempotent: a split
    //    that doesn't match no-ops.
    await rehome_claimed_transactions(ctx, payload);
    (0, observability_1.log_operation_success)(span, payload.user_id);
}
/**
 * Enqueue re-assignment of transactions currently on Everything Else that fall
 * in the new budget's range, so the engine can move the ones now claimed by it.
 */
async function rehome_claimed_transactions(ctx, payload) {
    const txn_ids = await (0, budget_rehome_resolver_1.resolve_created_rehome_transaction_ids)(ctx, payload.user_id, payload.budget_id, payload.everything_else_budget_id, payload.start_ms, payload.generation_end_ms);
    for (const transaction_id of txn_ids) {
        await (0, job_queue_1.create_job)("assign_transaction", { user_id: payload.user_id, transaction_id }, { trace_id: ctx.trace_id });
    }
    if (txn_ids.length > 0) {
        console.log(`[${ctx.trace_id}] process_budget_created: re-homed ${txn_ids.length} ` +
            `transactions for budget ${payload.budget_id}`);
    }
}
/**
 * Groups claims by source budget and removes the categories from each.
 */
async function apply_claims(ctx, claims, target_budget_id, everything_else_budget_id, user_id) {
    var _a, _b;
    const removals = new Map();
    for (const claim of claims) {
        const source = (_a = claim.from_budget_id) !== null && _a !== void 0 ? _a : everything_else_budget_id;
        if (!source || source === target_budget_id) {
            continue;
        }
        const list = (_b = removals.get(source)) !== null && _b !== void 0 ? _b : [];
        list.push(claim.category_id);
        removals.set(source, list);
    }
    for (const [source_budget_id, category_ids] of removals) {
        await budget_repo_1.budget_repo.remove_category_ids(ctx, source_budget_id, category_ids, user_id);
    }
}
/**
 * Reads source periods in range, computes period entities, and saves them.
 */
async function generate_periods(ctx, payload) {
    const anchor = firestore_1.Timestamp.fromMillis(payload.start_ms);
    const generation_end = firestore_1.Timestamp.fromMillis(payload.generation_end_ms);
    // Overlap window: every source period from the budget start through the
    // 12-month (ongoing) / budget-end (limited) horizon, including the current
    // partial period.
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
    // Update user_summary documents AFTER all periods are saved (the CREATE
    // summary trigger was removed to avoid batch race conditions). Enqueues one
    // deduplicated job per affected period — cascades across all future summaries.
    const period_ids = computed.entities.map((p) => p.id);
    try {
        await (0, summaries_1.enqueue_user_summary_updates_from_budget_periods)(ctx, payload.user_id, period_ids);
    }
    catch (summary_error) {
        // Non-fatal: a failed summary update must not fail the cascade.
        console.error(`[${ctx.trace_id}] process_budget_created: summary update failed (non-fatal):`, summary_error);
    }
    // Write back period-range metadata (legacy parity).
    await write_back_period_range(ctx, payload, computed.entities, generation_end);
    // Periods now exist — recompute spend from any already-assigned splits. This
    // closes the race where transactions were assigned to this budget BEFORE its
    // periods existed (the assignment fan-out recompute found no periods and
    // wrote nothing). Full recompute (no transaction_date_ms → every period).
    await (0, job_queue_1.create_job)("recompute_budget_spent", { user_id: payload.user_id, budget_ids: [payload.budget_id] }, { trace_id: ctx.trace_id });
}
/**
 * Writes activePeriodRange + lastExtended (+ extension flags for recurring)
 * onto the budget, derived from the generated prime-type periods.
 */
async function write_back_period_range(ctx, payload, entities, generation_end) {
    const prime = entities.filter((e) => e.period_type === payload.cadence);
    if (prime.length === 0) {
        return;
    }
    const start_period_id = prime[0].period_id;
    const end_period_id = prime[prime.length - 1].period_id;
    try {
        await budget_repo_1.budget_repo.set_period_range(ctx, payload.budget_id, start_period_id, end_period_id, generation_end, payload.is_recurring, payload.user_id);
    }
    catch (range_error) {
        console.error(`[${ctx.trace_id}] process_budget_created: period-range write-back failed (non-fatal):`, range_error);
    }
}
//# sourceMappingURL=process_budget_created.orchestrator.js.map