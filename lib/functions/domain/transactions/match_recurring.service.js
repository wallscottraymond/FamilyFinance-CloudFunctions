"use strict";
/**
 * Match Recurring Domain Service
 *
 * Pure scoring + selection matching a transaction to a recurring period (a bill
 * occurrence / outflow period, or an income occurrence / inflow period). The
 * same algorithm serves both — the caller passes outflow candidates to get an
 * `outflow_id`, or inflow candidates to get an `inflow_id`, and the matched
 * period is the one to mark paid / received.
 *
 * Scoring (ported from `match_transaction_splits_to_outflows`):
 * - merchant (bidirectional substring, case-insensitive): +50
 * - amount within 10% of the expected amount: +30
 * - due-date within 7 days: +(20 − days×2) (closer = higher)
 * - threshold to match: 50; highest score wins; already-settled candidates skipped.
 *
 * NO async, NO IO, NO side effects. Time injected as epoch ms.
 *
 * @module domain/transactions/match_recurring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECURRING_MATCH_THRESHOLD = void 0;
exports.score_recurring_match = score_recurring_match;
exports.match_recurring = match_recurring;
/** Minimum score to count as a match. */
exports.RECURRING_MATCH_THRESHOLD = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Score how well a transaction matches a recurring candidate (0–100). PURE.
 */
function score_recurring_match(txn, candidate) {
    var _a, _b;
    let score = 0;
    // Merchant (bidirectional substring, case-insensitive).
    const m = (_a = txn.merchant_name) === null || _a === void 0 ? void 0 : _a.toLowerCase();
    const cm = (_b = candidate.merchant_name) === null || _b === void 0 ? void 0 : _b.toLowerCase();
    if (m && cm && (m.includes(cm) || cm.includes(m))) {
        score += 50;
    }
    // Amount within 10% of the expected amount.
    if (candidate.expected_amount > 0) {
        const diff = Math.abs(txn.amount - candidate.expected_amount);
        if (diff <= candidate.expected_amount * 0.1) {
            score += 30;
        }
    }
    // Due-date proximity (within 7 days).
    if (candidate.due_date_ms !== null) {
        const days = Math.abs(txn.date_ms - candidate.due_date_ms) / DAY_MS;
        if (days <= 7) {
            score += 20 - days * 2;
        }
    }
    return score;
}
/**
 * Pick the best recurring match (highest score ≥ threshold). Settled candidates
 * are skipped. Returns no match if none clears the threshold.
 *
 * PURE FUNCTION.
 */
function match_recurring(txn, candidates) {
    let best = null;
    let best_score = 0;
    for (const candidate of candidates) {
        if (candidate.is_settled) {
            continue;
        }
        const score = score_recurring_match(txn, candidate);
        if (score > best_score && score >= exports.RECURRING_MATCH_THRESHOLD) {
            best_score = score;
            best = candidate;
        }
    }
    if (best) {
        return {
            matched: true,
            recurring_id: best.recurring_id,
            period_id: best.period_id,
            score: best_score,
        };
    }
    return { matched: false, recurring_id: null, period_id: null, score: 0 };
}
//# sourceMappingURL=match_recurring.service.js.map