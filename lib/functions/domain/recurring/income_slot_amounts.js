"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimate_slot_amounts = estimate_slot_amounts;
/** UTC day-of-month (1..31) of a timestamp. PURE. */
function utc_day_of_month(ms) {
    return new Date(ms).getUTCDate();
}
/** Circular distance between two days-of-month (so the 1st is near the 30th). PURE. */
function day_distance(a, b) {
    const d = Math.abs(a - b);
    return Math.min(d, 31 - d);
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
function estimate_slot_amounts(occurrence_days, deposits, recent_n = 6) {
    const slots = [...new Set(occurrence_days)];
    const out = new Map();
    // Single (or no) occurrence day → nothing to differentiate; use the stream average.
    if (slots.length <= 1)
        return out;
    const by_slot = new Map();
    for (const day of slots)
        by_slot.set(day, []);
    for (const dep of deposits) {
        const dom = utc_day_of_month(dep.date_ms);
        let best = slots[0];
        let best_dist = Infinity;
        for (const day of slots) {
            const dist = day_distance(dom, day);
            if (dist < best_dist) {
                best_dist = dist;
                best = day;
            }
        }
        by_slot.get(best).push(dep);
    }
    for (const [day, deps] of by_slot) {
        if (deps.length === 0)
            continue;
        const recent = [...deps].sort((a, b) => a.date_ms - b.date_ms).slice(-recent_n);
        const avg = recent.reduce((s, d) => s + d.amount, 0) / recent.length;
        out.set(day, Math.round(avg * 100) / 100);
    }
    return out;
}
//# sourceMappingURL=income_slot_amounts.js.map