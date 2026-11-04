"use strict";
/**
 * A Fund (Manual-Budgets F1-F5): one total that doesn't reset. Spending comes off the total, in any
 * month, until it ends. Separately it sets aside an even share of each month's income, which is what
 * the month's plan and the Everything-Else leftover count. PURE.
 *
 * @module domain/budgets/fund
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fund_month_count = fund_month_count;
exports.fund_monthly_share = fund_monthly_share;
exports.fund_forward_share = fund_forward_share;
exports.fund_position = fund_position;
/** Calendar months a fund touches, counted in UTC, at least 1. PURE. */
function fund_month_count(start_ms, end_ms) {
    const s = new Date(start_ms);
    const e = new Date(end_ms);
    const months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth() + 1;
    return Math.max(1, months);
}
const cents = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
/** The even share: total ÷ months. PURE. */
function fund_monthly_share(total, start_ms, end_ms) {
    return cents(total / fund_month_count(start_ms, end_ms));
}
/**
 * The share after the total changes (F2): what's still to set aside ÷ the months left. Past months
 * keep what they set aside. Never below zero. PURE.
 */
function fund_forward_share(total, past_shares, months_left) {
    const set_aside = past_shares.reduce((sum, share) => sum + share, 0);
    return cents(Math.max(0, total - set_aside) / Math.max(1, months_left));
}
function fund_position(total, spent_to_date) {
    return { total, spent_to_date, left: cents(total - spent_to_date) };
}
//# sourceMappingURL=fund.service.js.map