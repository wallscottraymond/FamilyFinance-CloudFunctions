"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.match_deposits_to_income_lines = match_deposits_to_income_lines;
const normalize = (s) => (s !== null && s !== void 0 ? s : "").trim().toUpperCase();
/** Income line id → the Plaid ids of deposits that pay it and aren't listed on it yet. */
function match_deposits_to_income_lines(deposits, lines) {
    var _a;
    const on_a_stream = new Set(lines.flatMap((l) => l.transaction_ids));
    const live = lines.filter((l) => l.is_active && !l.is_hidden && normalize(l.description) !== "");
    const out = new Map();
    for (const d of deposits) {
        if (d.is_pending || !d.is_other_income || on_a_stream.has(d.plaid_id))
            continue;
        const name = normalize(d.name);
        if (!name || !d.account_id)
            continue;
        const matches = live.filter((l) => {
            var _a;
            return normalize(l.description) === name &&
                l.account_id === d.account_id &&
                (l.first_date_ms === null || d.date_ms >= l.first_date_ms) &&
                !((_a = l.removal_intervals) !== null && _a !== void 0 ? _a : []).some((iv) => d.date_ms >= iv.from_ms && (iv.to_ms === null || d.date_ms <= iv.to_ms));
        });
        if (matches.length !== 1)
            continue;
        out.set(matches[0].id, [...((_a = out.get(matches[0].id)) !== null && _a !== void 0 ? _a : []), d.plaid_id]);
    }
    return out;
}
//# sourceMappingURL=income_payer_match.service.js.map