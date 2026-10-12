/**
 * Split Category — THE one way a split's category is decided (Category & Mapping Canon M7).
 *
 * The `categories` collection is a translation layer between Plaid and our budgets (canon §0).
 * Every path that needs a split's category calls `resolve_split_category` with the same catalog:
 * the assignment engine (stored fields), derive-on-read (the period page), sync's in-memory
 * assignment, transfer pairing and the audit. The app does not re-derive — it reads the stored
 * `firstCategoryId` the engine writes from this function.
 *
 *   1. the user's (or a rule's) pick  — `categorySource: "user"` with a first / second slug
 *   2. else the collection's merchant & keyword rules (only when Plaid left it unresolved)
 *   3. else the Plaid detailed code → its collection doc → `firstCategoryId` / `overallCategoryId`
 *   4. else Other (`OTHER_EXPENSE`'s doc) — never null (canon C7)
 *
 * The legacy `internalDetailedCategory` / `internalPrimaryCategory` fields are NOT read (canon M2).
 *
 * PURE: no IO.
 *
 * @module domain/transactions/split_category
 */

import { match_category, CategoryRule, DEFAULT_CATEGORY } from "./match_category.service";

/** The category collection, reduced to what resolution needs. Built once per batch / request. */
export interface CategoryCatalog {
  /** Plaid detailed code (= category doc id) → its slugs. */
  slugs_by_plaid: Record<string, { overall_category_id: string | null; first_category_id: string | null }>;
  /** Merchant / keyword rules (from the collection's `merchants` / `keywords`). */
  rules: CategoryRule[];
  /** first slug → one Plaid code under it (gives a user pick its income / transfer meaning). */
  plaid_by_first: Record<string, string>;
  /** first slug → its overall slug. */
  overall_by_first: Record<string, string | null>;
}

/** A category doc as the collection stores it (id = Plaid detailed code). */
export interface CategoryDocForCatalog {
  id: string;
  data: Record<string, unknown>;
}

export function build_category_catalog(docs: CategoryDocForCatalog[]): CategoryCatalog {
  const slugs_by_plaid: CategoryCatalog["slugs_by_plaid"] = {};
  const plaid_by_first: Record<string, string> = {};
  const overall_by_first: Record<string, string | null> = {};
  const rules: CategoryRule[] = [];
  // Deterministic: first doc (by id) under a first wins as its representative code.
  for (const { id, data } of [...docs].sort((a, b) => a.id.localeCompare(b.id))) {
    const first = (data.firstCategoryId as string | null) ?? null;
    const overall = (data.overallCategoryId as string | null) ?? null;
    slugs_by_plaid[id] = { overall_category_id: overall, first_category_id: first };
    if (first) {
      if (!(first in plaid_by_first)) plaid_by_first[first] = id;
      if (!(first in overall_by_first)) overall_by_first[first] = overall;
    }
    rules.push({
      category: id,
      merchants: (data.merchants as string[]) ?? [],
      keywords: (data.keywords as string[]) ?? [],
    });
  }
  return { slugs_by_plaid, rules, plaid_by_first, overall_by_first };
}

/** What resolution reads from a split + its transaction. */
export interface SplitCategoryInput {
  plaid_detailed: string | null;
  category_source?: "plaid" | "user" | null;
  first_category_id?: string | null;
  overall_category_id?: string | null;
  second_category_id?: string | null;
  merchant_name?: string | null;
  name?: string | null;
}

export interface ResolvedSplitCategory {
  first_category_id: string | null;
  overall_category_id: string | null;
  /** Only a user pin to a specific Plaid detail; else null. */
  second_category_id: string | null;
  category_source: "plaid" | "user";
  /**
   * The Plaid code that gives this category its MEANING (income? transfer?): the resolved code
   * for a Plaid split, the pinned detail or a representative code of the chosen first for a user
   * pick — so reclassifying a transfer to "Shopping" makes it spending, everywhere.
   */
  semantic_code: string;
  /**
   * The identifiers a budget can claim this split by, MOST SPECIFIC FIRST. A user pick never
   * includes the original Plaid code (so a budget still holding that code can't beat the pick).
   */
  match_keys: string[];
  /** True for a user pick (budgets claim it by the first it falls under, incl. legacy codes). */
  is_user_pick: boolean;
}

export function resolve_split_category(
  input: SplitCategoryInput,
  catalog: CategoryCatalog
): ResolvedSplitCategory {
  // 1. User / rule pick.
  if (input.category_source === "user" && (input.first_category_id || input.second_category_id)) {
    const second = input.second_category_id ?? null;
    const first =
      (second ? catalog.slugs_by_plaid[second]?.first_category_id : null) ??
      input.first_category_id ??
      null;
    const overall =
      (second ? catalog.slugs_by_plaid[second]?.overall_category_id : null) ??
      (first ? catalog.overall_by_first[first] ?? null : null) ??
      input.overall_category_id ??
      null;
    const semantic = second ?? (first ? catalog.plaid_by_first[first] : undefined) ?? DEFAULT_CATEGORY;
    return {
      first_category_id: first,
      overall_category_id: overall,
      second_category_id: second,
      category_source: "user",
      semantic_code: semantic,
      match_keys: [second, first, overall].filter((k): k is string => !!k),
      is_user_pick: true,
    };
  }

  // 2–4. Plaid code (upgraded by merchant / keyword rules when unresolved) → collection → Other.
  const resolved = match_category(
    {
      plaid_match_category: input.plaid_detailed ?? DEFAULT_CATEGORY,
      merchant_name: input.merchant_name ?? null,
      name: input.name ?? null,
    },
    catalog.rules
  ).category;
  const code = catalog.slugs_by_plaid[resolved] ? resolved : DEFAULT_CATEGORY;
  const slugs = catalog.slugs_by_plaid[code] ?? { overall_category_id: null, first_category_id: null };
  return {
    first_category_id: slugs.first_category_id,
    overall_category_id: slugs.overall_category_id,
    second_category_id: null,
    category_source: "plaid",
    semantic_code: resolved,
    match_keys: [resolved, slugs.first_category_id, slugs.overall_category_id].filter(
      (k): k is string => !!k
    ),
    is_user_pick: false,
  };
}

/**
 * The first-category slugs a budget covers, from whatever its `categoryIds` hold (slugs and/or
 * legacy Plaid codes) — so a user pick of "groceries" lands in a budget that still stores
 * `FOOD_AND_DRINK_GROCERIES`. Used only to match USER picks (Plaid splits keep exact-code
 * matching, so a budget holding one code of a first never silently widens to the whole first).
 */
export function budget_first_ids(category_ids: string[], catalog: CategoryCatalog): string[] {
  const out = new Set<string>();
  for (const id of category_ids) {
    const first =
      catalog.slugs_by_plaid[id]?.first_category_id ?? (id in catalog.plaid_by_first ? id : null);
    if (first) out.add(first);
  }
  return [...out];
}
