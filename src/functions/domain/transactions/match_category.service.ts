/**
 * Match Category Domain Service
 *
 * Pure logic resolving a transaction's internal category from category rules:
 * keep an already-meaningful category, else match by merchant (exact, case-
 * insensitive), else by a keyword substring in the transaction name, else the
 * default. The resolver loads the category rules; this picks one.
 *
 * NO async, NO IO, NO side effects.
 *
 * @module domain/transactions/match_category
 */

/** Default category when nothing matches (mirrors the legacy `OTHER_EXPENSE`). */
export const DEFAULT_CATEGORY = "OTHER_EXPENSE";

/** The transaction fields category matching reads. */
export interface TransactionForCategoryMatch {
  /** Plaid DETAILED category (the match vocabulary); `OTHER_EXPENSE` = unresolved. */
  plaid_match_category: string;
  merchant_name: string | null;
  name: string | null;
}

/** A category rule from the `categories` collection. */
export interface CategoryRule {
  /** The category to assign on a match. */
  category: string;
  /** Merchant names that map to this category (compared case-insensitively). */
  merchants: string[];
  /** Keywords; a case-insensitive substring of the transaction name matches. */
  keywords: string[];
}

/** Result of category matching. */
export interface CategoryMatchResult {
  category: string;
  matched_by: "existing" | "merchant" | "keyword" | "default";
}

/**
 * Resolve a transaction's category.
 *
 * Precedence: an existing non-default category is kept (Plaid already
 * categorised it / a user override is upstream); otherwise merchant match, then
 * keyword match, then the default.
 *
 * PURE FUNCTION.
 */
export function match_category(
  txn: TransactionForCategoryMatch,
  rules: CategoryRule[]
): CategoryMatchResult {
  // Already meaningfully categorised → keep it.
  if (txn.plaid_match_category && txn.plaid_match_category !== DEFAULT_CATEGORY) {
    return { category: txn.plaid_match_category, matched_by: "existing" };
  }

  // Merchant match (exact, case-insensitive).
  const merchant = txn.merchant_name?.toLowerCase().trim();
  if (merchant) {
    for (const rule of rules) {
      if (rule.merchants.some((m) => m.toLowerCase().trim() === merchant)) {
        return { category: rule.category, matched_by: "merchant" };
      }
    }
  }

  // Keyword match (substring of the transaction name).
  const name = txn.name?.toLowerCase();
  if (name) {
    for (const rule of rules) {
      if (rule.keywords.some((k) => k && name.includes(k.toLowerCase()))) {
        return { category: rule.category, matched_by: "keyword" };
      }
    }
  }

  return { category: DEFAULT_CATEGORY, matched_by: "default" };
}
