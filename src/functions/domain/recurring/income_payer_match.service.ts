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
  removal_intervals?: Array<{ from_ms: number; to_ms: number | null }>;
}

const normalize = (s: string | null | undefined): string => (s ?? "").trim().toUpperCase();

/** Income line id → the Plaid ids of deposits that pay it and aren't listed on it yet. */
export function match_deposits_to_income_lines(
  deposits: DepositForPayerMatch[],
  lines: IncomeLineForPayerMatch[]
): Map<string, string[]> {
  const on_a_stream = new Set(lines.flatMap((l) => l.transaction_ids));
  const live = lines.filter((l) => l.is_active && !l.is_hidden && normalize(l.description) !== "");
  const out = new Map<string, string[]>();
  for (const d of deposits) {
    if (d.is_pending || !d.is_other_income || on_a_stream.has(d.plaid_id)) continue;
    const name = normalize(d.name);
    if (!name || !d.account_id) continue;
    const matches = live.filter(
      (l) =>
        normalize(l.description) === name &&
        l.account_id === d.account_id &&
        (l.first_date_ms === null || d.date_ms >= l.first_date_ms) &&
        !(l.removal_intervals ?? []).some(
          (iv) => d.date_ms >= iv.from_ms && (iv.to_ms === null || d.date_ms <= iv.to_ms)
        )
    );
    if (matches.length !== 1) continue;
    out.set(matches[0].id, [...(out.get(matches[0].id) ?? []), d.plaid_id]);
  }
  return out;
}
