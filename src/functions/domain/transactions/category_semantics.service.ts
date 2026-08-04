/**
 * Plaid personal-finance category semantics.
 *
 * Pure string predicates that classify a Plaid detailed category as an internal
 * TRANSFER or real INCOME. Shared by BOTH the assignment engine (routing, at
 * ingestion) and the budget spend calc (read-time), so a transfer/income is
 * treated identically everywhere — new transactions, webhook syncs, backfills,
 * and other accounts all route the same way.
 *
 * @module domain/transactions/category_semantics
 */

/**
 * Money moving between the user's own accounts (and to/from savings, investments,
 * withdrawals) is tagged by Plaid with a `TRANSFER_IN_*` / `TRANSFER_OUT_*`
 * detailed category — even though our `type` maps those to income/expense by
 * sign. Such splits are NOT spending: they never auto-assign to a budget and are
 * excluded from budget totals. PURE.
 */
export function is_transfer_category(category: string | null | undefined): boolean {
  if (!category) return false;
  return category.startsWith("TRANSFER_IN") || category.startsWith("TRANSFER_OUT");
}

/**
 * A Plaid `INCOME_*` detailed category = real income (salary, wages, dividends).
 * It belongs to the recurring-income (inflow) system, never a spending budget —
 * excluded even when it hasn't been routed to an inflow yet. PURE.
 */
export function is_income_category(category: string | null | undefined): boolean {
  if (!category) return false;
  return category.startsWith("INCOME");
}
