/**
 * A Fund (Manual-Budgets F1-F5): one total that doesn't reset. Spending comes off the total, in any
 * month, until it ends. Separately it sets aside an even share of each month's income, which is what
 * the month's plan and the Everything-Else leftover count. PURE.
 *
 * @module domain/budgets/fund
 */
/** Calendar months a fund touches, counted in UTC, at least 1. PURE. */
export declare function fund_month_count(start_ms: number, end_ms: number): number;
/** The even share: total ÷ months. PURE. */
export declare function fund_monthly_share(total: number, start_ms: number, end_ms: number): number;
/**
 * The share after the total changes (F2): what's still to set aside ÷ the months left. Past months
 * keep what they set aside. Never below zero. PURE.
 */
export declare function fund_forward_share(total: number, past_shares: number[], months_left: number): number;
/** A fund's position at the end of a period. `left` below zero means over. PURE. */
export interface FundPosition {
    total: number;
    spent_to_date: number;
    left: number;
}
export declare function fund_position(total: number, spent_to_date: number): FundPosition;
//# sourceMappingURL=fund.service.d.ts.map