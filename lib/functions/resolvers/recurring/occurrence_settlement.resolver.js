"use strict";
/**
 * Occurrence Settlement Resolver ("Mark as paid / received")
 *
 * READ-ONLY. Loads what `set_occurrence_settled` needs about a bill / income: its owner + groups
 * (auth), its existing marks, and its expected-amount inputs shaped EXACTLY as the period page
 * reads them (definition override over Plaid's average; income: per-occurrence overrides and,
 * when asked, the stream's deposit history for the per-slot estimate).
 *
 * @module resolvers/recurring/occurrence_settlement
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_occurrence_settlement_context = resolve_occurrence_settlement_context;
const outflow_repo_1 = require("../../repositories/outflow.repo");
const inflow_repo_1 = require("../../repositories/inflow.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const income_slot_amounts_1 = require("../../domain/recurring/income_slot_amounts");
/**
 * Resolve the item, or null when it doesn't exist / is inactive.
 *
 * @param with_history - INCOME: also load the stream's deposits for the per-slot estimate
 *                       (only needed to default a mark's amount to the expected one).
 */
async function resolve_occurrence_settlement_context(ctx, kind, recurring_id, with_history) {
    var _a, _b, _c, _d, _e, _f, _g;
    if (kind === "outflow") {
        const o = await outflow_repo_1.outflow_repo.get_by_id(ctx, recurring_id);
        if (!o)
            return null;
        return {
            owner_id: o.user_id,
            group_ids: (_a = o.group_ids) !== null && _a !== void 0 ? _a : [],
            marks: (_b = o.manual_settled_occurrences) !== null && _b !== void 0 ? _b : {},
            item: {
                id: o.id,
                kind: "outflow",
                schedule: {
                    frequency: o.frequency,
                    // User override ("this + future") wins over Plaid's average — as the page reads it.
                    average_amount: (_c = o.expected_amount_override) !== null && _c !== void 0 ? _c : o.average_amount,
                    first_date: o.first_date,
                    last_date: o.last_date,
                    predicted_next_date: o.predicted_next_date,
                    source: o.source,
                },
            },
        };
    }
    const i = await inflow_repo_1.inflow_repo.get_by_id(ctx, recurring_id);
    if (!i)
        return null;
    const has_amount_override = i.expected_amount_override != null;
    let payment_history;
    if (with_history && !has_amount_override && ((_d = i.transaction_ids) !== null && _d !== void 0 ? _d : []).length > 0) {
        const docs = await transaction_repo_1.transaction_repo.get_by_plaid_transaction_ids(ctx, i.user_id, i.transaction_ids);
        payment_history = docs
            .map((d) => (0, income_slot_amounts_1.history_doc_to_deposit)(d))
            .filter((d) => d !== null);
    }
    return {
        owner_id: i.user_id,
        group_ids: (_e = i.group_ids) !== null && _e !== void 0 ? _e : [],
        marks: (_f = i.manual_settled_occurrences) !== null && _f !== void 0 ? _f : {},
        item: {
            id: i.id,
            kind: "inflow",
            schedule: {
                frequency: i.frequency,
                average_amount: (_g = i.expected_amount_override) !== null && _g !== void 0 ? _g : i.average_amount,
                first_date: i.first_date,
                last_date: i.last_date,
                predicted_next_date: i.predicted_next_date,
                source: i.source,
            },
            has_amount_override,
            payment_history,
            occurrence_amount_overrides: i.occurrence_amount_overrides,
        },
    };
}
//# sourceMappingURL=occurrence_settlement.resolver.js.map