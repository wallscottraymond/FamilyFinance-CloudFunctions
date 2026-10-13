/**
 * A period's normal share of a budget, from the CALENDAR alone (Transaction-Integrity X10).
 *
 * Every period of the budget's own cadence gets exactly `budget.amount`, so a period of another
 * type (a week of a monthly budget, a month of a weekly one) normally gets
 * `budget.amount × share`, where share = Σ over its days of 1 ÷ the length of the budget-cadence
 * period containing that day:
 *  - monthly    → that month's days;
 *  - weekly     → 7;
 *  - bi_monthly → 15 (1st–15th) or the month's days − 15 (16th–end).
 * No stored period lists are read, so missing / stale `primePeriodIds`, duplicate year-boundary
 * weeks or legacy docs can't skew it. Days are UTC calendar days. PURE.
 */

const DAY_MS = 86_400_000;

function utc_day(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function days_in_month(day_ms: number): number {
  const d = new Date(day_ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/** The length (days) of the budget-cadence period containing this UTC day, or null if unknown. */
function cadence_length(day_ms: number, cadence: string): number | null {
  switch (String(cadence).toLowerCase()) {
  case "monthly":
    return days_in_month(day_ms);
  case "weekly":
    return 7;
  case "bi_monthly": {
    const dom = new Date(day_ms).getUTCDate();
    return dom <= 15 ? 15 : days_in_month(day_ms) - 15;
  }
  default:
    return null;
  }
}

/**
 * The period [start_ms, end_ms] (inclusive, any time of day)'s share of a budget of `cadence`.
 * Returns null for a cadence it can't place (caller falls back).
 */
export function budget_share_of_period(
  start_ms: number,
  end_ms: number,
  cadence: string
): number | null {
  let share = 0;
  for (let day = utc_day(start_ms); day <= utc_day(end_ms); day += DAY_MS) {
    const len = cadence_length(day, cadence);
    if (len === null) return null;
    share += 1 / len;
  }
  return share;
}
