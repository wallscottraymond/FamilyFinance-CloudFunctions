/**
 * A deposit whose description exactly matches an income line pays that line (AF-08).
 *
 * Plaid's stream list decides which deposits belong to an income line, and it can lag or never
 * list one: a $100,236.72 paycheck stayed off its line for days, counted as Other Income, while
 * the line showed that paycheck as not received. An exact payer description on the same account is
 * as certain as Plaid's own grouping, so the deposit links now.
 *
 * Deliberately narrow, because a wrong link hides money under the wrong line:
 *   - the EXACT description on the SAME account (Plaid's pending form reads differently);
 *   - a posted credit that would otherwise be Other Income, with every split agreeing;
 *   - on or after the line's first date, on a live line, outside any span it was removed for;
 *   - exactly one line matches. Two lines sharing a description: no guess.
 *
 * PURE: no IO.
 *
 * @module domain/recurring/income_payer_match
 */
export interface DepositForPayerMatch {
    plaid_id: string;
    name: string | null;
    account_id: string | null;
    date_ms: number;
    is_pending: boolean;
    /** Every split would count as Other Income (`is_other_income_split`). */
    is_other_income: boolean;
}
export interface IncomeLineForPayerMatch {
    id: string;
    description: string | null;
    account_id: string | null;
    first_date_ms: number | null;
    is_active: boolean;
    is_hidden: boolean;
    transaction_ids: string[];
    /** Spans the user removed or paused the line for: a deposit in one doesn't pay it. */
    removal_intervals?: Array<{
        from_ms: number;
        to_ms: number | null;
    }>;
}
/** Income line id → the Plaid ids of deposits that pay it and aren't listed on it yet. */
export declare function match_deposits_to_income_lines(deposits: DepositForPayerMatch[], lines: IncomeLineForPayerMatch[]): Map<string, string[]>;
//# sourceMappingURL=income_payer_match.service.d.ts.map