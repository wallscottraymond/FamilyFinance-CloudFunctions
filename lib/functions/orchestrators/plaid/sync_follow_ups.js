"use strict";
/**
 * Sync follow-ups — the ONE pass that runs after a Plaid sync's writes.
 *
 * A sync stamps its transaction writes with `syncRunId`, so `on_transaction_written` skips them
 * (no per-transaction assignment job, no recompute-per-day job, no reconcile-per-write job).
 * Instead the sync collects what its writes affected and runs this once, inline:
 *
 *   1. reconcile each affected bill / income stream (paid / received status) — once per stream
 *   2. recompute `spent` for each affected budget, over exactly the periods its dates fall in
 *   3. re-check internal transfers when transactions or streams changed
 *   4. bump the derive version once
 *
 * For a 3,000-transaction first link this replaces ~690 queued jobs (each waiting for the
 * 5-minute sweep) with one pass that finishes in the same invocation.
 *
 * @module orchestrators/plaid/sync_follow_ups
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.empty_follow_ups = void 0;
exports.follow_ups_from_written = follow_ups_from_written;
exports.merge_follow_ups = merge_follow_ups;
exports.run_sync_follow_ups = run_sync_follow_ups;
const firestore_1 = require("firebase-admin/firestore");
const reconcile_recurring_periods_orchestrator_1 = require("../recurring/reconcile_recurring_periods.orchestrator");
const recompute_budget_spent_orchestrator_1 = require("../budgets/recompute_budget_spent.orchestrator");
const classify_internal_transfers_orchestrator_1 = require("./classify_internal_transfers.orchestrator");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const job_queue_1 = require("../../infrastructure/job_queue");
const empty_follow_ups = () => ({
    budget_dates: {},
    outflow_ids: [],
    inflow_ids: [],
    transactions_changed: false,
    recurring_changed: false,
    transfers_changed: false,
});
exports.empty_follow_ups = empty_follow_ups;
const ids_of = (doc, denorm, split_field) => {
    var _a;
    if (!doc)
        return [];
    const d = doc[denorm];
    if (d)
        return d;
    return ((_a = doc.splits) !== null && _a !== void 0 ? _a : [])
        .map((s) => s[split_field])
        .filter((id) => !!id);
};
const date_of = (doc) => {
    const t = doc === null || doc === void 0 ? void 0 : doc.transactionDate;
    return t instanceof firestore_1.Timestamp ? t.toMillis() : null;
};
/** What a set of transaction writes affects — before ∪ after, so an un-link or move is covered. */
function follow_ups_from_written(written) {
    var _a;
    const budget_dates = new Map();
    const outflows = new Set();
    const inflows = new Set();
    let transfers_changed = false;
    for (const w of written) {
        const primary = String((_a = w.after.plaidPrimaryCategory) !== null && _a !== void 0 ? _a : "");
        if (primary.startsWith("TRANSFER") || primary === "LOAN_PAYMENTS")
            transfers_changed = true;
        for (const doc of [w.before, w.after]) {
            const ms = date_of(doc);
            if (ms !== null) {
                for (const b of ids_of(doc, "splitBudgetIds", "budgetId")) {
                    if (b === "unassigned")
                        continue;
                    if (!budget_dates.has(b))
                        budget_dates.set(b, new Set());
                    budget_dates.get(b).add(ms);
                }
            }
            ids_of(doc, "splitOutflowIds", "outflowId").forEach((id) => outflows.add(id));
            ids_of(doc, "splitInflowIds", "inflowId").forEach((id) => inflows.add(id));
        }
    }
    return {
        budget_dates: Object.fromEntries([...budget_dates].map(([k, v]) => [k, [...v]])),
        outflow_ids: [...outflows],
        inflow_ids: [...inflows],
        transactions_changed: written.length > 0,
        recurring_changed: false,
        transfers_changed,
    };
}
function merge_follow_ups(a, b) {
    var _a, _b, _c, _d;
    const budget_dates = Object.assign({}, a.budget_dates);
    for (const [k, v] of Object.entries((_a = b.budget_dates) !== null && _a !== void 0 ? _a : {})) {
        budget_dates[k] = [...new Set([...((_b = budget_dates[k]) !== null && _b !== void 0 ? _b : []), ...v])];
    }
    return {
        budget_dates,
        outflow_ids: [...new Set([...a.outflow_ids, ...((_c = b.outflow_ids) !== null && _c !== void 0 ? _c : [])])],
        inflow_ids: [...new Set([...a.inflow_ids, ...((_d = b.inflow_ids) !== null && _d !== void 0 ? _d : [])])],
        transactions_changed: a.transactions_changed || !!b.transactions_changed,
        recurring_changed: a.recurring_changed || !!b.recurring_changed,
        transfers_changed: a.transfers_changed || !!b.transfers_changed,
    };
}
const RECONCILE_CONCURRENCY = 4;
/** Run the follow-up pass once. Each step is non-fatal; a failed step falls back to a queued job. */
async function run_sync_follow_ups(ctx, user_id, f, opts) {
    const started = Date.now();
    // 1. Bills / income: one reconcile per affected stream.
    const streams = [
        ...f.outflow_ids.map((id) => ({ id, type: "outflow" })),
        ...f.inflow_ids.map((id) => ({ id, type: "inflow" })),
    ];
    for (let i = 0; i < streams.length; i += RECONCILE_CONCURRENCY) {
        await Promise.all(streams.slice(i, i + RECONCILE_CONCURRENCY).map(async (s) => {
            try {
                await (0, reconcile_recurring_periods_orchestrator_1.reconcile_recurring_periods_orchestrator)(ctx, {
                    recurring_id: s.id,
                    recurring_type: s.type,
                    user_id,
                    trace_id: ctx.trace_id,
                });
            }
            catch (error) {
                console.error(`[${ctx.trace_id}] follow-up reconcile ${s.type} ${s.id} failed; queued instead:`, error);
                await (0, job_queue_1.coalesce_job)("reconcile_recurring_period", {
                    deduplication_key: `reconcile:${s.type}:${s.id}`,
                    recurring_id: s.id,
                    recurring_type: s.type,
                    user_id,
                    trace_id: ctx.trace_id,
                }, { delay_seconds: 30, trace_id: ctx.trace_id }).catch(() => { });
            }
        }));
    }
    // 2. Budgets: one recompute over exactly the periods the written dates fall in.
    const budget_ids = Object.keys(f.budget_dates);
    if (budget_ids.length > 0) {
        try {
            await (0, recompute_budget_spent_orchestrator_1.recompute_budget_spent_orchestrator)(ctx, Object.assign({ user_id,
                budget_ids, dates_ms_by_budget: f.budget_dates }, ((opts === null || opts === void 0 ? void 0 : opts.preload_budget_window) ? { preload_window: true } : {})));
        }
        catch (error) {
            console.error(`[${ctx.trace_id}] follow-up recompute failed; queued a full recompute instead:`, error);
            await (0, job_queue_1.coalesce_job)("recompute_budget_spent", { deduplication_key: `recompute_full:${user_id}`, user_id, budget_ids }, { delay_seconds: 30, trace_id: ctx.trace_id }).catch(() => { });
        }
    }
    // 3. Internal transfers — after BOTH transactions and streams are in place, so matched pairs
    //    can be found (it used to run inside the recurring sync, before a new item's history landed).
    if (f.transfers_changed || f.recurring_changed) {
        try {
            // Streams unchanged → the fingerprint can skip; new transfer txns → must re-pair.
            await (0, classify_internal_transfers_orchestrator_1.classify_internal_transfers_orchestrator)(ctx, user_id, Date.now(), {
                force: f.transfers_changed,
            });
        }
        catch (error) {
            console.error(`[${ctx.trace_id}] follow-up transfer check failed (non-fatal):`, error);
        }
    }
    // 4. One derive-cache invalidation for everything above.
    if (f.transactions_changed || f.recurring_changed) {
        await (0, derive_version_repo_1.bump_derive_version)(user_id).catch(() => { });
    }
    console.log(`[${ctx.trace_id}] sync follow-ups: streams=${streams.length}, budgets=${budget_ids.length}, ` +
        `took=${Date.now() - started}ms`);
}
//# sourceMappingURL=sync_follow_ups.js.map