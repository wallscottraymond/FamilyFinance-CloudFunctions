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
 *  - monthly / quarterly / yearly / custom / unknown (they allocate on the monthly grid —
 *    `budget_cadence_to_instance` — each month gets the full amount) → 1/month days.
 * "All Periods Forward": new budget amount = typed amount ÷ this share, so the edited period then
 * shows what was typed (to the cent, modulo rounding of the stored monthly home). PURE.
 */
/** The period [start_ms, end_ms] (inclusive, any time of day)'s share of a budget of `cadence`. */
export declare function page_share(start_ms: number, end_ms: number, cadence: string): number;
//# sourceMappingURL=period_share.service.d.ts.map