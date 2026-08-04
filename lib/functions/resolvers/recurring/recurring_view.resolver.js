"use strict";
/**
 * Recurring View Resolver
 *
 * READ-ONLY dependency gathering for deriving a bill (recurring outflow) OR
 * income (recurring inflow) view on read (Derive-On-Read Period Architecture —
 * Phase 3). Both kinds share the schedule shape (frequency + anchor dates +
 * amount) and the same 3 pure primitives; only the repo + the split link field
 * differ. Fetches, bounded to the visible window:
 *   1. the item's SCHEDULE from its definition — the source of truth (the stored
 *      period docs are stale),
 *   2. the view's calendar buckets — `source_periods` of the requested cadence,
 *   3. the item's ACTUAL payments/receipts — transaction splits linked by
 *      `outflowId`/`inflowId` in the window.
 *
 * No generation/reconciliation/placement here (pure domain, run by the
 * orchestrator). No writes.
 *
 * @module resolvers/recurring/recurring_view
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_recurring_view_deps = resolve_recurring_view_deps;
const firestore_1 = require("firebase-admin/firestore");
const repositories_1 = require("../../repositories");
const transaction_repo_1 = require("../../repositories/transaction.repo");
/** Resolve the item's schedule + display name + split link field, or null. */
async function resolve_source(ctx, user_id, kind, recurring_id) {
    if (kind === "outflow") {
        const o = await repositories_1.outflow_repo.get_by_id(ctx, recurring_id);
        if (!o || o.user_id !== user_id) {
            return null;
        }
        return {
            schedule: {
                frequency: o.frequency,
                average_amount: o.average_amount,
                first_date: o.first_date,
                last_date: o.last_date,
                predicted_next_date: o.predicted_next_date,
            },
            name: o.user_custom_name || o.merchant_name || o.description || "Bill",
            link_field: "outflowId",
        };
    }
    const i = await repositories_1.inflow_repo.get_by_id(ctx, recurring_id);
    if (!i || i.user_id !== user_id) {
        return null;
    }
    return {
        schedule: {
            frequency: i.frequency,
            average_amount: i.average_amount,
            first_date: i.first_date,
            last_date: i.last_date,
            predicted_next_date: i.predicted_next_date,
        },
        name: i.user_custom_name || i.payer_name || i.description || "Income",
        link_field: "inflowId",
    };
}
/**
 * Gather the derivation inputs for `(kind, recurring_id, view_cadence, window)`.
 * Returns `null` when the item doesn't exist or isn't owned by the caller.
 */
async function resolve_recurring_view_deps(ctx, user_id, kind, recurring_id, view_cadence, window_start_ms, window_end_ms) {
    var _a, _b, _c, _d;
    const source = await resolve_source(ctx, user_id, kind, recurring_id);
    if (!source) {
        return null;
    }
    // 1. View buckets: source periods of the requested cadence overlapping the window.
    const overlapping = await repositories_1.source_period_repo.get_overlapping(ctx, firestore_1.Timestamp.fromMillis(window_start_ms), firestore_1.Timestamp.fromMillis(window_end_ms));
    const buckets = overlapping
        .filter((p) => p.period_type === view_cadence)
        .map((p) => ({
        period_id: p.period_id,
        start_ms: p.start_date.toMillis(),
        end_ms: p.end_date.toMillis(),
    }));
    if (buckets.length === 0) {
        return {
            name: source.name,
            schedule: source.schedule,
            buckets: [],
            payments: [],
            span_start_ms: window_start_ms,
            span_end_ms: window_end_ms,
        };
    }
    const span_start_ms = Math.min(...buckets.map((b) => b.start_ms));
    const span_end_ms = Math.max(...buckets.map((b) => b.end_ms));
    // 2. Actual payments/receipts: splits linked to this item over the span.
    const txns = await transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, user_id, span_start_ms, span_end_ms);
    const payments = [];
    for (const { id, data } of txns) {
        const txn_date_ms = data.transactionDate.toMillis();
        const splits = (_a = data.splits) !== null && _a !== void 0 ? _a : [];
        for (const s of splits) {
            if (s[source.link_field] !== recurring_id) {
                continue;
            }
            payments.push({
                transaction_id: id,
                split_id: (_c = (_b = s.splitId) !== null && _b !== void 0 ? _b : s.id) !== null && _c !== void 0 ? _c : null,
                date_ms: txn_date_ms,
                amount: Math.abs((_d = s.amount) !== null && _d !== void 0 ? _d : 0),
            });
        }
    }
    return {
        name: source.name,
        schedule: source.schedule,
        buckets,
        payments,
        span_start_ms,
        span_end_ms,
    };
}
//# sourceMappingURL=recurring_view.resolver.js.map