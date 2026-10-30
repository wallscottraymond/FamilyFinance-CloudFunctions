"use strict";
/**
 * Capture rules v2 (Convert-To-Recurring Phase 1) — constants + pure predicates.
 *
 * OLD vs NEW records (D13): a bill / income record created while the per-user flag is on is
 * stamped `captureRulesVersion: 2` AT CREATION (never later). Every v2 rule keys off that stamp,
 * which every reader already loads with the record — no extra reads, no cutoff date, and a record
 * that exists without the stamp keeps today's behavior forever (Plaid's guesses, today's transfer
 * hiding, Plaid turning it on and off). Turning the flag off only stops NEW stamping (D16).
 *
 * PURE: no IO.
 *
 * @module domain/recurring/capture_rules
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CARD_PAYMENT_CATEGORY = exports.CONVERT_TO_RECURRING_FLAG = exports.CAPTURE_RULES_VERSION = void 0;
exports.is_v2_record = is_v2_record;
exports.is_low_confidence_stream = is_low_confidence_stream;
exports.is_tombstoned_stream = is_tombstoned_stream;
exports.is_transfer_detailed = is_transfer_detailed;
exports.is_card_payment_inflow = is_card_payment_inflow;
exports.is_credit_or_loan_account = is_credit_or_loan_account;
exports.may_suggest_stream = may_suggest_stream;
/** The stamp written on records created under the new capture rules. */
exports.CAPTURE_RULES_VERSION = 2;
/** Server-only per-user flag (`_feature_flags/convert_to_recurring_v1`, owner allowlist). */
exports.CONVERT_TO_RECURRING_FLAG = "convert_to_recurring_v1";
/** Credit-card "payment" category: a real bill on the paying account; on the card it is not income. */
exports.CARD_PAYMENT_CATEGORY = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
/** True when a record (doc or entity) carries the v2 stamp. */
function is_v2_record(r) {
    if (!r)
        return false;
    return r.captureRulesVersion === exports.CAPTURE_RULES_VERSION || r.capture_rules_version === exports.CAPTURE_RULES_VERSION;
}
/**
 * A NEW Plaid stream Plaid itself is unsure of (D6 / D8): early detection, unknown status, or an
 * UNKNOWN frequency (the transformer silently maps that to monthly, inventing due dates). Reads
 * the RAW stream values, never the transformed ones (X10).
 */
function is_low_confidence_stream(raw_status, raw_frequency) {
    const status = String(raw_status !== null && raw_status !== void 0 ? raw_status : "UNKNOWN").toUpperCase();
    const frequency = String(raw_frequency !== null && raw_frequency !== void 0 ? raw_frequency : "UNKNOWN").toUpperCase();
    return status === "EARLY_DETECTION" || status === "UNKNOWN" || frequency === "UNKNOWN";
}
/** A dead stream Plaid keeps reporting (D17: a NEW tombstoned stream is skipped). */
function is_tombstoned_stream(raw_status) {
    return String(raw_status !== null && raw_status !== void 0 ? raw_status : "").toUpperCase() === "TOMBSTONED";
}
/** Plaid's `TRANSFER_IN_*` / `TRANSFER_OUT_*` detailed codes (an own-account move or an ACH). */
function is_transfer_detailed(detailed) {
    return /^TRANSFER_(IN|OUT)/.test(String(detailed !== null && detailed !== void 0 ? detailed : "").toUpperCase());
}
/** A card-side "payment received" credit (gap 3): hidden at creation and in the classifier (X7). */
function is_card_payment_inflow(detailed) {
    return String(detailed !== null && detailed !== void 0 ? detailed : "").toUpperCase() === exports.CARD_PAYMENT_CATEGORY;
}
/** Account types income suggestions never come from (X17: card / loan "credits" aren't income). */
function is_credit_or_loan_account(account_type) {
    const t = String(account_type !== null && account_type !== void 0 ? account_type : "").toLowerCase();
    return t === "credit" || t === "loan";
}
/**
 * May a Plaid low-confidence stream become a "suggested" tile at all (X14 / X17, B-P4)?
 *   - transfers never (an early own-account transfer stream is noise, not a bill);
 *   - income only for `INCOME_*` categories, and never on a credit / loan account.
 */
function may_suggest_stream(direction, detailed, account_type) {
    if (is_transfer_detailed(detailed))
        return false;
    if (direction === "inflow") {
        if (!String(detailed !== null && detailed !== void 0 ? detailed : "").toUpperCase().startsWith("INCOME"))
            return false;
        if (is_credit_or_loan_account(account_type))
            return false;
    }
    return true;
}
//# sourceMappingURL=capture_rules.js.map