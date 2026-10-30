"use strict";
/**
 * Manual income pin (Convert-To-Recurring Phase 2) — PURE.
 *
 * "This deposit is a payment of THAT income": the income twin of the manual bill pin. The split
 * records `inflowAssignmentSource: "manual"` + the income, which the assignment engine preserves
 * across re-syncs and beats Plaid stream membership (a pin to an income other than the stream's
 * takes the split off the stream). Rules (review items 11 / P9):
 *   - only the transaction's OWNER, and only an income of the same owner;
 *   - only money coming in (`type: "income"`), and never a transfer crossing the view (edge money);
 *   - only an income in the transaction's own view (Me / the group the account is shared with);
 *   - a pin replaces a budget pin and a bill pin on the split (an income payment is neither).
 *
 * @module domain/recurring/inflow_pin
 */
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.plan_inflow_pin = plan_inflow_pin;
exports.apply_inflow_pin_to_split = apply_inflow_pin_to_split;
const stream_membership_1 = require("./stream_membership");
/** May `user_id` pin this split to this income (or clear the pin)? PURE. */
function plan_inflow_pin(user_id, facts, split_id, inflow_id) {
    if (facts.txn.owner_id !== user_id) {
        return { ok: false, code: "PERMISSION_DENIED", message: "Only the owner of a transaction can assign it" };
    }
    if (!facts.txn.split_ids.includes(split_id)) {
        return { ok: false, code: "NOT_FOUND", message: "That split doesn't exist" };
    }
    if (inflow_id === null)
        return { ok: true, clear: true };
    // One answer for "no such income" and "someone else's income": nothing about it is revealed.
    if (!facts.inflow || facts.inflow.owner_id !== user_id) {
        return { ok: false, code: "PERMISSION_DENIED", message: "That income isn't available" };
    }
    if (!facts.inflow.is_active || facts.inflow.is_hidden) {
        return { ok: false, code: "NOT_FOUND", message: "That income isn't available" };
    }
    if (facts.txn.type !== "income" || (0, stream_membership_1.is_edge_money)(facts.txn.transfer_role)) {
        return { ok: false, code: "NOT_AN_INCOME_PAYMENT", message: "Only money coming in can be assigned to an income" };
    }
    if (facts.txn_view !== facts.inflow_view) {
        return { ok: false, code: "OUT_OF_VIEW", message: "That income isn't in this transaction's view" };
    }
    return { ok: true, clear: false };
}
/**
 * The split after the pin (or after clearing it). A pin replaces a budget pin and a bill pin (a
 * "remove from bill" detach stays); clearing it removes the marker so the engine re-derives. Keys
 * are added only when set (a split that never had a pin stays byte-identical). PURE.
 */
function apply_inflow_pin_to_split(split, inflow_id) {
    /* eslint-disable @typescript-eslint/naming-convention */
    if (inflow_id === null) {
        const { inflowAssignmentSource: _drop } = split, rest = __rest(split, ["inflowAssignmentSource"]);
        void _drop;
        return Object.assign(Object.assign({}, rest), { inflowId: null });
    }
    const detached = split.outflowAssignmentSource === "manual" && !split.outflowId;
    return Object.assign(Object.assign(Object.assign({}, split), { inflowId: inflow_id, inflowAssignmentSource: "manual", outflowId: null, outflowAssignmentSource: detached ? "manual" : "auto", outflowPinnedPeriodId: null, suspendedOutflowPinId: null }), (split.budgetAssignmentSource === "manual" ? { budgetAssignmentSource: "category" } : {}));
    /* eslint-enable @typescript-eslint/naming-convention */
}
//# sourceMappingURL=inflow_pin.service.js.map