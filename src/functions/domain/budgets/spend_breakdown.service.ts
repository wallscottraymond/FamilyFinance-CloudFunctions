/**
 * Spend Breakdown Domain Service
 *
 * The pieces behind the Budgets page "Easy to change" tips, built from the SAME counted splits as a
 * budget period's `spent` (accumulated inside `compute_budget_spent`'s loop, so they can't drift):
 * where the money went (places) and what bank fees it held (fees). No reads of its own: the place
 * and fee fields ride on each split from the transactions derive already loaded.
 *
 * PURE: no IO.
 *
 * @module domain/budgets/spend_breakdown
 */

/** A bank-fee split's kind (from its Plaid `BANK_FEES_*` code). */
export type FeeKind = "atm" | "late" | "overdraft" | "foreign" | "interest" | "other";

/** A purchase under this (dollars) counts as a small one. */
export const SMALL_PURCHASE_LIMIT = 25;
/** Places kept per budget period: the top this-many by total UNION the top this-many by purchase
 *  count (so a frequent small habit isn't cut by a few big buys) — up to twice this many. */
export const TOP_PLACES = 8;

export interface PlaceSpend {
  key: string;
  name: string;
  /** Purchases (splits that add spend). */
  count: number;
  /** Purchases under SMALL_PURCHASE_LIMIT. */
  small_count: number;
  /** Net spend there, to the cent. */
  total: number;
  /** The place's most common resolved Plaid detailed code among its purchases ("" if unknown). */
  code: string;
}

export interface FeeSpend {
  kind: FeeKind;
  count: number;
  total: number;
}

/** Whether a Plaid code is a bank fee (the BANK_FEES primary). PURE. */
export function is_bank_fee_code(code: string | null | undefined): boolean {
  return typeof code === "string" && code.startsWith("BANK_FEES");
}

/** A `BANK_FEES_*` code → its kind; null for any other code. PURE. */
export function fee_kind_of(code: string | null | undefined): FeeKind | null {
  if (!is_bank_fee_code(code)) return null;
  const c = code as string;
  if (c === "BANK_FEES_ATM_FEES") return "atm";
  if (c.includes("LATE")) return "late";
  if (c === "BANK_FEES_OVERDRAFT_FEES" || c === "BANK_FEES_INSUFFICIENT_FUNDS") return "overdraft";
  if (c === "BANK_FEES_FOREIGN_TRANSACTION_FEES") return "foreign";
  if (c === "BANK_FEES_INTEREST_CHARGE") return "interest"; // card interest
  return "other";
}

/**
 * A split's fee kind from its resolved category. A user pick of the Bank Fees category without a
 * specific detail carries a REPRESENTATIVE code (any fee), so its kind comes from Plaid's own code
 * when that is a fee too, else "other". PURE.
 */
export function split_fee_kind(
  resolved: { semantic_code: string; category_source: "plaid" | "user"; second_category_id: string | null },
  plaid_detailed: string | null | undefined
): FeeKind | null {
  if (!is_bank_fee_code(resolved.semantic_code)) return null;
  if (resolved.category_source === "user" && !resolved.second_category_id) {
    return fee_kind_of(plaid_detailed) ?? "other";
  }
  return fee_kind_of(resolved.semantic_code);
}

/** The most frequent key (ties → alphabetical, so the result is deterministic); "" if none. */
function most_common(counts: Map<string, number>): string {
  let best = "";
  let best_n = 0;
  for (const [k, n] of counts) {
    if (n > best_n || (n === best_n && k < best)) {
      best = k;
      best_n = n;
    }
  }
  return best;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100 + 0;
}

/** Accumulates places + fees over a period's counted splits (one `add` per counted split). */
export class SpendBreakdownAccumulator {
  private readonly places = new Map<
    string,
    { name: string; count: number; small: number; total: number; codes: Map<string, number> }
  >();
  private readonly fees = new Map<FeeKind, { count: number; total: number }>();

  /** `signed` = the split's contribution to `spent` (negative for a credit that nets it down). */
  add(
    split: {
      vendor_key?: string | null;
      place_name?: string | null;
      fee_kind?: FeeKind | null;
      category_code?: string | null;
    },
    signed: number
  ): void {
    const is_purchase = signed > 0;
    if (split.vendor_key) {
      const p = this.places.get(split.vendor_key) ??
        { name: split.place_name || split.vendor_key, count: 0, small: 0, total: 0, codes: new Map() };
      p.total += signed;
      if (is_purchase) {
        p.count += 1;
        if (signed < SMALL_PURCHASE_LIMIT) p.small += 1;
        if (split.category_code) {
          p.codes.set(split.category_code, (p.codes.get(split.category_code) ?? 0) + 1);
        }
      }
      this.places.set(split.vendor_key, p);
    }
    if (split.fee_kind) {
      const f = this.fees.get(split.fee_kind) ?? { count: 0, total: 0 };
      f.total += signed;
      if (is_purchase) f.count += 1;
      this.fees.set(split.fee_kind, f);
    }
  }

  /**
   * The places to show (positive totals only): the top `limit` by total UNION the top `limit` by
   * purchase count, deduped, sorted by total desc (ties by count, then name) — up to 2 × `limit`.
   */
  top_places(limit = TOP_PLACES): PlaceSpend[] {
    const all: PlaceSpend[] = [...this.places.entries()]
      .map(([key, p]) => ({
        key, name: p.name, count: p.count, small_count: p.small, total: round2(p.total),
        code: most_common(p.codes),
      }))
      .filter((p) => p.total > 0);
    const by_total = (a: PlaceSpend, b: PlaceSpend) =>
      b.total - a.total || b.count - a.count || a.name.localeCompare(b.name);
    const by_count = (a: PlaceSpend, b: PlaceSpend) =>
      b.count - a.count || b.total - a.total || a.name.localeCompare(b.name);
    const keep = new Set([
      ...[...all].sort(by_total).slice(0, limit).map((p) => p.key),
      ...[...all].sort(by_count).slice(0, limit).map((p) => p.key),
    ]);
    return all.filter((p) => keep.has(p.key)).sort(by_total);
  }

  /** Fee kinds charged in the period (at least one fee, net total > 0), by total desc. */
  fee_list(): FeeSpend[] {
    return [...this.fees.entries()]
      .map(([kind, f]) => ({ kind, count: f.count, total: round2(f.total) }))
      .filter((f) => f.count > 0 && f.total > 0)
      .sort((a, b) => b.total - a.total || a.kind.localeCompare(b.kind));
  }
}
