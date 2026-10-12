/**
 * Split Category Edit — what a split edit writes to a split's category fields (canon M1, M2, M3).
 *
 * The split editor sends the whole splits array. For each split this decides the category
 * fields to store, from (in order):
 *   1. the app's explicit pick — `categorySource: "user"` + a known `firstCategoryId`
 *      (or `secondCategoryId` = a Plaid code), validated against the collection;
 *      `categorySource: "plaid"` on a split that was a user pick = "use auto" (reset);
 *   2. a bare `categoryId` from older app builds (a first slug or a Plaid code), translated to
 *      the same pick — only when it CHANGED and lands on a different first than the split has,
 *      so re-saving an untouched split never turns it into a pick (Plaid keeps updating it, M4);
 *   3. otherwise the split's stored category, unchanged.
 * The Plaid codes are immutable (M1): an existing split keeps its own; a new split inherits the
 * transaction's. The legacy `internal*` fields are always written null (M2).
 *
 * PURE: no IO.
 *
 * @module domain/transactions/split_category_edit
 */

import { CategoryCatalog, resolve_split_category } from "./split_category.service";

/* eslint-disable @typescript-eslint/naming-convention */
export interface SplitCategoryFields {
  plaidPrimaryCategory: string | null;
  plaidDetailedCategory: string | null;
  categorySource: "plaid" | "user";
  firstCategoryId: string | null;
  overallCategoryId: string | null;
  secondCategoryId: string | null;
  internalPrimaryCategory: null;
  internalDetailedCategory: null;
}
/* eslint-enable @typescript-eslint/naming-convention */

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** A first slug or Plaid code → the first slug it means (null when unknown). */
function first_of(id: string | null, catalog: CategoryCatalog): string | null {
  if (!id) return null;
  if (id in catalog.plaid_by_first) return id;
  return catalog.slugs_by_plaid[id]?.first_category_id ?? null;
}

/** As `first_of`, also reading a legacy display name (old rule writes stored "Shopping"). */
function legacy_first_of(id: string | null, catalog: CategoryCatalog): string | null {
  if (!id) return null;
  return first_of(id, catalog) ?? catalog.first_by_name[id.trim().toLowerCase()] ?? null;
}

/**
 * A split's LEGACY override (`internalDetailedCategory`, else `internalPrimaryCategory` — a Plaid
 * code or a slug from older writers) as the first slug it means, when it differs from what Plaid
 * gives the split. Null when there's none, it's unknown, or it agrees with Plaid. Shared with the
 * one-time backfill so an edit before the backfill keeps the user's old pick.
 */
export function legacy_override_first(split: Raw, catalog: CategoryCatalog): string | null {
  if (split.categorySource === "user") return null;
  const first =
    legacy_first_of(str(split.internalDetailedCategory), catalog) ??
    legacy_first_of(str(split.internalPrimaryCategory), catalog);
  if (!first) return null;
  const plaid_first = resolve_split_category(
    { plaid_detailed: str(split.plaidDetailedCategory) },
    catalog
  ).first_category_id;
  return first !== plaid_first ? first : null;
}

/* eslint-disable @typescript-eslint/naming-convention */
function user_pick(
  first: string,
  second: string | null,
  plaid: { primary: string | null; detailed: string | null },
  catalog: CategoryCatalog
): SplitCategoryFields {
  const r = resolve_split_category(
    {
      plaid_detailed: plaid.detailed,
      category_source: "user",
      first_category_id: first,
      second_category_id: second,
    },
    catalog
  );
  return {
    plaidPrimaryCategory: plaid.primary,
    plaidDetailedCategory: plaid.detailed,
    categorySource: "user",
    firstCategoryId: r.first_category_id,
    overallCategoryId: r.overall_category_id,
    secondCategoryId: r.second_category_id,
    internalPrimaryCategory: null,
    internalDetailedCategory: null,
  };
}

function from_plaid(
  plaid: { primary: string | null; detailed: string | null },
  catalog: CategoryCatalog
): SplitCategoryFields {
  const r = resolve_split_category({ plaid_detailed: plaid.detailed }, catalog);
  return {
    plaidPrimaryCategory: plaid.primary,
    plaidDetailedCategory: plaid.detailed,
    categorySource: "plaid",
    firstCategoryId: r.first_category_id,
    overallCategoryId: r.overall_category_id,
    secondCategoryId: null,
    internalPrimaryCategory: null,
    internalDetailedCategory: null,
  };
}

/* eslint-enable @typescript-eslint/naming-convention */

/**
 * @param incoming - The split as the app sent it
 * @param existing - The stored split with the same id (undefined = a new split)
 * @param txn - The stored transaction (its first split's Plaid codes seed a new split)
 */
export function resolve_split_category_edit(
  incoming: Raw,
  existing: Raw | undefined,
  txn: Raw,
  catalog: CategoryCatalog
): SplitCategoryFields {
  const txn_first = ((txn.splits as Raw[]) ?? [])[0] ?? {};
  const plaid = existing
    ? {
      primary: str(existing.plaidPrimaryCategory),
      detailed: str(existing.plaidDetailedCategory),
    }
    : {
      primary:
        str(incoming.plaidPrimaryCategory) ??
        str(txn_first.plaidPrimaryCategory) ??
        str(txn.plaidPrimaryCategory),
      detailed:
        str(incoming.plaidDetailedCategory) ??
        str(txn_first.plaidDetailedCategory) ??
        str(txn.plaidDetailedCategory),
    };

  // The split's category as stored now (a new split: what Plaid gives it).
  const stored_first =
    existing?.categorySource === "user" ? first_of(str(existing.firstCategoryId), catalog) : null;
  const stored_second =
    str(existing?.secondCategoryId) && catalog.slugs_by_plaid[existing?.secondCategoryId as string]
      ? (existing?.secondCategoryId as string)
      : null;
  const current: SplitCategoryFields =
    stored_first
      ? user_pick(stored_first, stored_second, plaid, catalog)
      : existing && legacy_override_first(existing, catalog)
        ? user_pick(legacy_override_first(existing, catalog) as string, null, plaid, catalog)
        : from_plaid(plaid, catalog);

  // 1. Explicit pick from the app.
  if (incoming.categorySource === "user") {
    const second =
      str(incoming.secondCategoryId) && catalog.slugs_by_plaid[incoming.secondCategoryId as string]
        ? (incoming.secondCategoryId as string)
        : null;
    const first =
      (second ? first_of(second, catalog) : null) ??
      first_of(str(incoming.firstCategoryId), catalog);
    if (first) return user_pick(first, second, plaid, catalog);
    // Unknown slug → fall through (never store a category outside the collection).
  } else if (incoming.categorySource === "plaid" && existing?.categorySource === "user") {
    // "Use auto": the app flipped a STORED user pick back to Plaid. (A legacy override isn't a
    // stored pick yet, so re-sending its "plaid" source keeps it.)
    return from_plaid(plaid, catalog);
  }

  // 2. Older builds: a bare `categoryId`, only when it changed and means a different first.
  const sent = str(incoming.categoryId);
  const stored_sent = existing ? str(existing.categoryId) : null;
  if (sent && sent.toLowerCase() !== "other" && sent !== stored_sent) {
    const first = first_of(sent, catalog);
    if (first && first !== current.firstCategoryId) {
      // A Plaid code sent by an old build is a FIRST pick (canon C8: pick at first).
      return user_pick(first, null, plaid, catalog);
    }
  }

  // 3. Unchanged.
  return current;
}
