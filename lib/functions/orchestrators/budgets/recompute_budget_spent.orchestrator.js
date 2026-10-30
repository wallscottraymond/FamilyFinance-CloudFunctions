"use strict";
/**
 * Recompute Budget Spent Orchestrator
 *
 * The Budget-Transaction-Spend-Pipeline consumer of the assignment engine's
 * fan-out. For each touched budget, finds the period(s) containing the
 * transaction's date and RECOMPUTES their `spent`/`pendingSpent`/`remaining`
 * from the currently-assigned splits (invalidation-based — never incremented),
 * then refreshes the affected user_summary documents.
 *
 * Dispatched from the `_jobs` queue as `recompute_budget_spent`.
 *
 * @module orchestrators/budgets/recompute_budget_spent
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.recompute_budget_spent_orchestrator = recompute_budget_spent_orchestrator;
const observability_1 = require("../../observability");
const budget_period_repo_1 = require("../../repositories/budget_period.repo");
const budget_repo_1 = require("../../repositories/budget.repo");
const budget_spend_service_1 = require("../../domain/budgets/budget_spend.service");
const budgets_1 = require("../../domain/budgets");
const budget_spend_resolver_1 = require("../../resolvers/budgets/budget_spend.resolver");
const job_queue_1 = require("../../infrastructure/job_queue");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const edge_transfers_service_1 = require("../../domain/periods/edge_transfers.service");
/** Budgets recomputed at once (their reads overlap; shared windows are read once). */
const BUDGET_CONCURRENCY = 4;
function round2(value) {
    return Math.round(value * 100) / 100;
}
/**
 * Recompute spent for the touched budgets' affected periods.
 *
 * @returns Count of periods updated.
 */
async function recompute_budget_spent_orchestrator(ctx, input) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "recompute_budget_spent");
    (0, observability_1.log_operation_start)(span, input.user_id);
    try {
        const affected_period_ids = [];
        let periods_updated = 0;
        // GATHER (reads only, budgets in parallel): each budget's cadence + the periods to recompute.
        const gather = async (budget_id) => {
            var _a, _b;
            // Read the budget once: its `period` selects which split-lens field spend is
            // matched on (monthly→monthlyBudgetId, weekly→weeklyBudgetId, …), applied to
            // ALL its periods (prime + non-prime). Reused for the rollover gate below.
            const budget = await budget_repo_1.budget_repo.get_by_id(ctx, budget_id);
            // A GROUP budget's spend comes from every member's shared accounts; this job only loads
            // the user's own transactions, so it would store a partial number. Group views derive
            // their budgets on read — leave the group budget's stored mirror alone.
            if (budget && String((_a = budget.user_id) !== null && _a !== void 0 ? _a : "").startsWith("group:")) {
                return null;
            }
            const cadence = budget
                ? (0, budgets_1.budget_cadence_to_instance)(budget.period)
                : "monthly";
            // Date-scoped (engine fan-out) reads only the periods that could CONTAIN the txn date
            // (periodStart within 40d before it) — not the budget's whole lifetime (~138 docs) —
            // then keeps the exact containing period(s). Full mode (backfill, no date) reads all.
            const many = (_b = input.dates_ms_by_budget) === null || _b === void 0 ? void 0 : _b[budget_id];
            const periods = many !== undefined || input.transaction_date_ms === undefined
                ? await budget_period_repo_1.budget_period_repo.get_by_budget_id(ctx, budget_id)
                : await budget_period_repo_1.budget_period_repo.get_by_budget_id_in_date_window(ctx, budget_id, input.transaction_date_ms);
            const contains = (ms) => (p) => ms >= p.start_date.toMillis() && ms <= p.end_date.toMillis();
            const affected = many !== undefined
                ? periods.filter((p) => many.some((ms) => contains(ms)(p)))
                : input.transaction_date_ms === undefined
                    ? periods
                    : periods.filter(contains(input.transaction_date_ms));
            return affected.length === 0 ? null : { budget_id, budget, cadence, affected };
        };
        const gathered = [];
        for (let i = 0; i < input.budget_ids.length; i += BUDGET_CONCURRENCY) {
            const chunk = await Promise.all(input.budget_ids.slice(i, i + BUDGET_CONCURRENCY).map(gather));
            for (const g of chunk)
                if (g)
                    gathered.push(g);
        }
        // One read per distinct period window for the whole job (budgets share windows) — or, in
        // preload mode, ONE read covering every affected period (± the transfer-pairing slack).
        let preloaded;
        if (input.preload_window && gathered.length > 0) {
            const all = gathered.flatMap((g) => g.affected);
            const lo_ms = Math.min(...all.map((p) => p.start_date.toMillis())) - edge_transfers_service_1.TRANSFER_PAIRING_BUFFER_MS;
            const hi_ms = Math.max(...all.map((p) => p.end_date.toMillis())) + edge_transfers_service_1.TRANSFER_PAIRING_BUFFER_MS;
            preloaded = { lo_ms, hi_ms, txns: await transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, input.user_id, lo_ms, hi_ms) };
        }
        const load_txns = (0, budget_spend_resolver_1.create_window_txn_loader)(ctx, input.user_id, preloaded);
        // COMPUTE + WRITE (budgets in parallel; windows are memoized, so shared reads happen once).
        const apply = async ({ budget_id, budget, cadence, affected }) => {
            var _a;
            const updates = [];
            for (const p of affected) {
                const start_ms = p.start_date.toMillis();
                const end_ms = p.end_date.toMillis();
                const splits = await (0, budget_spend_resolver_1.resolve_spend_splits)(ctx, input.user_id, budget_id, start_ms, end_ms, cadence, load_txns);
                const { spent, pending_spent, return_amount } = (0, budget_spend_service_1.compute_budget_spent)(budget_id, start_ms, end_ms, splits);
                const effective = (_a = p.effective_amount) !== null && _a !== void 0 ? _a : p.allocated_amount + p.rolled_over_amount;
                updates.push({
                    id: p.id,
                    spent,
                    pending_spent,
                    remaining: round2(effective - spent),
                    return_amount,
                });
                affected_period_ids.push(p.id);
            }
            await budget_period_repo_1.budget_period_repo.update_spent(ctx, updates);
            periods_updated += updates.length;
            // Real-time rollover (the other half of the daily `calculateDailyRollover`
            // catch-up): a spend change invalidates this budget's rollover chain. Only
            // budgets with rollover ENABLED need it, so gate on a single budget read
            // and enqueue an async chain recompute (deduped per budget). The chain
            // writes rolledOverAmount/remaining — never spent — so it cannot re-enter
            // this pipeline. Non-fatal: a rollover hiccup must not fail the spend recompute.
            try {
                if (budget === null || budget === void 0 ? void 0 : budget.rollover_enabled) {
                    await (0, job_queue_1.create_job_if_not_exists)("recalculate_rollover", {
                        user_id: input.user_id,
                        budget_id,
                        deduplication_key: budget_id,
                    }, { trace_id: ctx.trace_id });
                }
            }
            catch (rollover_error) {
                console.error(`[${ctx.trace_id}] recompute_budget_spent: rollover enqueue failed (non-fatal):`, rollover_error);
            }
        };
        for (let i = 0; i < gathered.length; i += BUDGET_CONCURRENCY) {
            await Promise.all(gathered.slice(i, i + BUDGET_CONCURRENCY).map(apply));
        }
        // (user_summaries build retired)
        (0, observability_1.log_operation_success)(span, input.user_id);
        return { periods_updated };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: input.user_id, error_code: "RECOMPUTE_BUDGET_SPENT_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=recompute_budget_spent.orchestrator.js.map