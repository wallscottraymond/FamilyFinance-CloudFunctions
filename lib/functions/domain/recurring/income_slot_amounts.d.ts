/**
 * Per-slot income amount estimation (Income-Occurrence-Amounts-By-History).
 *
 * A recurring income stream can have occurrences of DIFFERENT sizes — e.g. a semi-monthly
 * paycheck where the mid-month check (~$3.3k, stable) and the end-of-month check (~$18k,
 * variable) differ every period. Generation gives every expected occurrence the single
 * stream average, so both showed the same blended figure. This estimates the expected
 * amount for EACH occurrence day from history: bucket the stream's actual deposits to the
 * nearest occurrence day-of-month, then average the most-recent `recent_n` in that slot.
 *
 * PURE: no IO. Returns amounts only for slots with ≥1 sample; callers fall back to the
 * stream average for unseen slots.
 *
 * @module domain/recurring/income_slot_amounts
 */
/** A historical deposit for slotting. */
export interface DepositForSlot {
    date_ms: number;
    amount: number;
}
/**
 * Estimate each occurrence day's expected amount from historical deposits.
 *
 * @param occurrence_days - Distinct days-of-month the occurrences land on (e.g. [15, 30]).
 * @param deposits        - The stream's historical linked deposits.
 * @param recent_n        - How many recent deposits per slot to average (default 6).
 * @returns Map dayOfMonth → estimated amount (only slots with samples). Empty when there's
 *          a single occurrence day (no per-slot differentiation needed) or no deposits.
 */
export declare function estimate_slot_amounts(occurrence_days: number[], deposits: DepositForSlot[], recent_n?: number): Map<number, number>;
//# sourceMappingURL=income_slot_amounts.d.ts.map