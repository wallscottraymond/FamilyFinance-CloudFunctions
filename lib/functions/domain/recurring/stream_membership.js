"use strict";
/**
 * Recurring stream membership map (shared by the derive read-path + the assignment engine).
 *
 * Builds `Plaid transaction id → recurring id` from a set of recurring definitions'
 * `transactionIds` (Plaid's authoritative stream membership). Used to link a transaction
 * to its bill/income deterministically — the reliable signal the fuzzy period matcher misses.
 *
 * CONFLICT RULE: if the SAME Plaid transaction id appears in TWO different streams
 * (Plaid over-assignment — e.g. one payment claimed by two credit-card bills), we do NOT
 * guess a winner (that was a non-deterministic last-writer-wins bug). The ambiguous id is
 * EXCLUDED from the map, so it falls back to fuzzy matching / stays unattributed rather than
 * being force-linked to an arbitrary bill. Deterministic regardless of input order.
 *
 * PURE: no IO.
 *
 * @module domain/recurring/stream_membership
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.build_stream_membership_map = build_stream_membership_map;
exports.is_split_detached_from_outflow = is_split_detached_from_outflow;
exports.is_txn_detached_from_outflow = is_txn_detached_from_outflow;
exports.is_split_detached_from_inflow = is_split_detached_from_inflow;
exports.is_txn_detached_from_inflow = is_txn_detached_from_inflow;
exports.splits_paying_recurring = splits_paying_recurring;
exports.is_edge_money = is_edge_money;
exports.is_manual_period_pin = is_manual_period_pin;
exports.is_split_on_stream = is_split_on_stream;
exports.is_other_income_split = is_other_income_split;
const budget_spend_service_1 = require("../budgets/budget_spend.service");
/** Build the `txn id → recurring id` map, excluding ids claimed by 2+ streams. PURE. */
function build_stream_membership_map(items) {
    var _a;
    const map = new Map();
    const ambiguous = new Set();
    for (const item of items) {
        for (const tx_id of (_a = item.transaction_ids) !== null && _a !== void 0 ? _a : []) {
            const existing = map.get(tx_id);
            if (existing !== undefined && existing !== item.id) {
                ambiguous.add(tx_id); // claimed by a different stream too → don't guess
            }
            else {
                map.set(tx_id, item.id);
            }
        }
    }
    for (const tx_id of ambiguous)
        map.delete(tx_id);
    return map;
}
/* eslint-enable @typescript-eslint/naming-convention */
/**
 * Is this split OFF its bills? It must beat every automatic link — the engine's recurring
 * matcher AND Plaid stream `transactionIds` membership (derive + reconcile) — or the payment
 * silently re-attaches. Off when:
 *   - a manual bill DETACH ("remove from bill"): `outflowAssignmentSource: "manual"` with no
 *     `outflowId` (a manual pin to "none");
 *   - a manual BUDGET pin without a manual bill pin (canon A4: a budget pin detaches recurring —
 *     the engine stores no bill link, so the page and reconcile must not re-link it by stream).
 * A manual bill pin (with a bill) is ON that bill, whatever the budget. PURE.
 */
function is_split_detached_from_outflow(split) {
    const s = (split !== null && split !== void 0 ? split : {});
    if (s.outflowAssignmentSource === "manual")
        return !s.outflowId;
    return s.budgetAssignmentSource === "manual";
}
/** True when ANY split of the transaction is off its bills. PURE. (Readers use the per-split
 *  `splits_paying_recurring` / `is_split_on_stream`.) */
function is_txn_detached_from_outflow(splits) {
    return (splits !== null && splits !== void 0 ? splits : []).some(is_split_detached_from_outflow);
}
/**
 * Is this split OFF its income streams? A manual budget pin (canon A4 / A13: a pinned income
 * credit counts in the pinned budget; the engine stores no income link), or — Convert-To-Recurring
 * Phase 2 — a manual INCOME pin to a different income than `stream_id` (the user said this credit
 * pays that income, so it is not also the stream's payment). A pin to the stream's own income stays
 * on it. PURE.
 */
function is_split_detached_from_inflow(split, stream_id) {
    const s = (split !== null && split !== void 0 ? split : {});
    if (s.budgetAssignmentSource === "manual")
        return true;
    return s.inflowAssignmentSource === "manual" && !!s.inflowId && !!stream_id && s.inflowId !== stream_id;
}
/** True when ANY split of the transaction is off its income streams. PURE. */
function is_txn_detached_from_inflow(splits) {
    return (splits !== null && splits !== void 0 ? splits : []).some((sp) => is_split_detached_from_inflow(sp));
}
/**
 * The splits of a transaction that PAY recurring `recurring_id` (PURE) — THE per-split rule the
 * period page, reconcile, the recurring transaction list and the engine share:
 *   - splits explicitly linked to it (`outflowId` / `inflowId`), when there are any;
 *   - else, when the transaction is in its Plaid stream (`in_stream`), every split that isn't
 *     taken off (a "remove from bill" detach / a budget pin) and isn't linked elsewhere.
 * Taking ONE split off never unlinks the others (a pin on part of a split bill payment leaves
 * the rest paying the bill).
 */
function splits_paying_recurring(splits, kind, recurring_id, in_stream) {
    const field = kind === "outflow" ? "outflowId" : "inflowId";
    const link = (sp) => { var _a; return (_a = (sp !== null && sp !== void 0 ? sp : {})[field]) !== null && _a !== void 0 ? _a : null; };
    const linked = splits.filter((sp) => link(sp) === recurring_id);
    if (linked.length || !in_stream)
        return linked;
    const off = kind === "outflow"
        ? is_split_detached_from_outflow
        : (sp) => is_split_detached_from_inflow(sp, recurring_id);
    return splits.filter((sp) => link(sp) === null && !off(sp));
}
/**
 * Edge money (3d: a transfer crossing the view — stored role `edge_out` / `edge_in`) is never a
 * bill payment or a paycheck: every reader drops its recurring links (the period page's
 * `without_recurring_links`). PURE.
 */
function is_edge_money(transfer_role) {
    return transfer_role === "edge_out" || transfer_role === "edge_in";
}
/**
 * A split's PERIOD pin (`outflowPinnedPeriodId`, the two-stage bill picker) counts only on a MANUAL
 * bill link — the pin's own. A pin left behind on a link the engine re-made automatically (the pinned
 * bill went inactive / hidden / out of the view) is stale: that payment is placed by its date. The
 * period page and stored reconcile both decide with this. PURE.
 */
function is_manual_period_pin(split) {
    const s = split;
    return !!s && typeof s.outflowPinnedPeriodId === "string" && s.outflowPinnedPeriodId !== "" &&
        s.outflowAssignmentSource === "manual";
}
/** Is this split ON its transaction's Plaid stream (member, not taken off)? PURE. */
function is_split_on_stream(split, kind, stream_id) {
    return kind === "outflow"
        ? !is_split_detached_from_outflow(split)
        : !is_split_detached_from_inflow(split, stream_id);
}
/**
 * Does this split count as "other income received" (PURE)? A CREDIT (money in — a debit the
 * user mis-tagged as income isn't income received) whose EFFECTIVE category (`semantic_code`; a
 * user's pick decides, canon M7) means income, that isn't paying an income (on its stream, or
 * linked by `inflowId`) and isn't pinned to a budget (a pinned income credit counts in that
 * budget — canon A13 — never also as income).
 */
function is_other_income_split(split, semantic_code, on_inflow_stream, is_credit) {
    var _a;
    const sp = (split !== null && split !== void 0 ? split : {});
    return (is_credit &&
        (0, budget_spend_service_1.split_spend_status)(sp) !== "ignored" && // an Ignored credit isn't counted anywhere
        semantic_code.startsWith("INCOME") &&
        !on_inflow_stream &&
        ((_a = sp.inflowId) !== null && _a !== void 0 ? _a : null) === null &&
        sp.budgetAssignmentSource !== "manual");
}
//# sourceMappingURL=stream_membership.js.map