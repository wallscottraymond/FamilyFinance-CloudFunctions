/**
 * A period's share of its budget under the PERIOD PAGE's rule (Transaction-Integrity X10,
 * "All Periods Forward").
 *
 * The page builds every view's allocation from the budget's MONTHLY home docs, spreading each
 * month evenly over its days (domain/budgets/period_allocation_view). So with no overrides or
 * adjustments, a period's allocation per $1 of `budget.amount` is Σ over its UTC days of the
 * month home's daily share, by the budget's cadence:
 *  - weekly     → 1/7 (the monthly home = the weekly primes' daily rate × the month's days);
 *  - bi_monthly → 2/month days (the monthly home holds 2 halves, spread evenly);
 *  - monthly / custom / unknown → 1/month days;
 *  - quarterly / yearly (monthly grid, each month gets a third / a twelfth of the amount —
 *    `budget_amount_per_instance`) → (1/3 or 1/12)/month days.
 * "All Periods Forward": new budget amount = typed amount ÷ this share, so the edited period then
 * shows what was typed (to the cent, modulo rounding of the stored monthly home). PURE.
 *
 * Partial months (batch 6 verify #3): generation prices a monthly record only over the budget's
 * PRICED days (`budget_priced_range`) and the page spreads it over those days alone
 * (`bucket_allocation`). So with `priced`, each day counts the month's price
 * (`monthly_price_unrounded`) ÷ the month's priced days, and days outside the range count 0.
 * Without `priced` every month is whole, which reduces to the per-cadence rules above.
 */
/** The period [start_ms, end_ms] (inclusive, any time of day)'s share of a budget of `cadence`. */
export declare function page_share(start_ms: number, end_ms: number, cadence: string, priced?: {
    from_ms: number;
    to_ms: number | null;
}): number;
//# sourceMappingURL=period_share.service.d.ts.map