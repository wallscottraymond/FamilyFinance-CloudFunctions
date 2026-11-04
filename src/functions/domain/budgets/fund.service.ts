/**
 * A Fund (Manual-Budgets F1-F5): one total that doesn't reset. Spending comes off the total, in any
 * month, until it ends. Separately it sets aside an even share of each month's income, which is what
 * the month's plan and the Everything-Else leftover count. PURE.
 *
 * @module domain/budgets/fund
 */

/** Calendar months a fund touches, counted in UTC, at least 1. PURE. */
export function fund_month_count(start_ms: number, end_ms: number): number {
  const s = new Date(start_ms);
  const e = new Date(end_ms);
  const months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth() + 1;
  return Math.max(1, months);
}

const cents = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** The even share: total ÷ months. PURE. */
export function fund_monthly_share(total: number, start_ms: number, end_ms: number): number {
  return cents(total / fund_month_count(start_ms, end_ms));
}

/**
 * The share after the total changes (F2): what's still to set aside ÷ the months left. Past months
 * keep what they set aside. Never below zero. PURE.
 */
export function fund_forward_share(total: number, past_shares: number[], months_left: number): number {
  const set_aside = past_shares.reduce((sum, share) => sum + share, 0);
  return cents(Math.max(0, total - set_aside) / Math.max(1, months_left));
}

/** A fund's position at the end of a period. `left` below zero means over. PURE. */
export interface FundPosition {
  total: number;
  spent_to_date: number;
  left: number;
}

export function fund_position(total: number, spent_to_date: number): FundPosition {
  return { total, spent_to_date, left: cents(total - spent_to_date) };
}
