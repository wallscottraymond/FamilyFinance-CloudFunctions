"use strict";
/**
 * Transfer / card-payment hiding for recurring records (Convert-To-Recurring X7, gaps 3 + 5).
 *
 * OLD records (no v2 stamp) keep today's rule forever (D13): a transfer stream is hidden as soon as
 * ANY one of its transactions is an internal matched pair; card payments are never hidden.
 *
 * v2 records:
 *   - TRANSFER streams — the MAJORITY rule, counted only over the stream's transactions inside the
 *     classifier's loaded window (the stream's ids reach back 730 days, the pairing window is ~180;
 *     a 24-month stream with every in-window leg paired must hide):
 *       hide   when ≥ 2 in-window legs pair AND ≥ 50 % of the in-window legs pair;
 *       unhide only when < 25 % pair (HYSTERESIS: a borderline stream never flips as the window
 *       slides — each flip rewrites the record + its periods and forces an FE re-derive);
 *       no in-window legs → keep the current state.
 *   - a card-side "payment received" INFLOW (LOAN_PAYMENTS_CREDIT_CARD_PAYMENT) is ALWAYS hidden —
 *     at creation and here, so the self-correcting unhide never flips it back daily. The paying
 *     side (an outflow) is a real bill and stays.
 *
 * PURE: no IO.
 *
 * @module domain/recurring/transfer_hiding
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_PAIRED = exports.UNHIDE_RATIO = exports.HIDE_RATIO = void 0;
exports.should_hide_v1 = should_hide_v1;
exports.should_hide_v2 = should_hide_v2;
exports.target_hidden = target_hidden;
const category_semantics_service_1 = require("../transactions/category_semantics.service");
const capture_rules_1 = require("./capture_rules");
exports.HIDE_RATIO = 0.5;
exports.UNHIDE_RATIO = 0.25;
exports.MIN_PAIRED = 2;
/** Today's rule (old records): any one paired leg hides a transfer stream; card payments never. */
function should_hide_v1(plaid_detailed_category, transaction_ids, internal_plaid_ids) {
    if (plaid_detailed_category === capture_rules_1.CARD_PAYMENT_CATEGORY)
        return false;
    if (!(0, category_semantics_service_1.is_transfer_category)(plaid_detailed_category))
        return false;
    return (transaction_ids !== null && transaction_ids !== void 0 ? transaction_ids : []).some((t) => internal_plaid_ids.has(t));
}
/** The v2 rule (see the module doc). Returns the TARGET hidden state. */
function should_hide_v2(r, window_plaid_ids, internal_plaid_ids) {
    var _a;
    if (r.plaid_detailed_category === capture_rules_1.CARD_PAYMENT_CATEGORY)
        return r.kind === "i";
    if (!(0, category_semantics_service_1.is_transfer_category)(r.plaid_detailed_category))
        return false;
    const in_window = ((_a = r.transaction_ids) !== null && _a !== void 0 ? _a : []).filter((t) => window_plaid_ids.has(t));
    if (in_window.length === 0)
        return r.is_hidden;
    const paired = in_window.filter((t) => internal_plaid_ids.has(t)).length;
    const ratio = paired / in_window.length;
    if (r.is_hidden)
        return ratio >= exports.UNHIDE_RATIO;
    return paired >= exports.MIN_PAIRED && ratio >= exports.HIDE_RATIO;
}
/** The target hidden state for any record: v1 for old records, v2 for stamped ones. */
function target_hidden(r, window_plaid_ids, internal_plaid_ids) {
    return r.v2
        ? should_hide_v2(r, window_plaid_ids, internal_plaid_ids)
        : should_hide_v1(r.plaid_detailed_category, r.transaction_ids, internal_plaid_ids);
}
//# sourceMappingURL=transfer_hiding.service.js.map