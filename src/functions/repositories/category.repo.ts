/**
 * Category Repository
 *
 * READ-ONLY persistence boundary for the `categories` reference collection.
 * Each category doc id is a Plaid DETAILED enum (e.g. FOOD_AND_DRINK_GROCERIES);
 * the assignment engine matches splits against these and a category's
 * merchant/keyword upgrade rules.
 *
 * Performance: `categories` is a reference collection that changes rarely but is
 * read on EVERY transaction assignment (per trigger fire / per backfill job). To
 * avoid a full collection scan on every invocation we cache the active set at
 * module scope with a short TTL — the cache survives across warm invocations on
 * the same instance. Mutations should call `invalidate_category_cache()`.
 *
 * @module repositories/category
 */

import { getFirestore } from "firebase-admin/firestore";
import { TraceContext } from "../types";

const COLLECTION = "categories";

/** Active-category cache shape. */
type CategoryDoc = { id: string; data: Record<string, unknown> };

/**
 * Module-scope cache of the active category docs. Mirrors the TTL-cache pattern
 * used by `infrastructure/config.ts`. `null` until first load or after
 * invalidation. The TTL bounds staleness if a mutation forgets to invalidate.
 */
let cached_active: CategoryDoc[] | null = null;
let cache_loaded_at = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetch_active(): Promise<CategoryDoc[]> {
  /* eslint-disable @typescript-eslint/naming-convention */
  const snapshot = await getFirestore()
    .collection(COLLECTION)
    .where("isActive", "==", true)
    .get();
  /* eslint-enable @typescript-eslint/naming-convention */
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as Record<string, unknown>,
  }));
}

export const category_repo = {
  /**
   * Gets all active category docs (raw data + id), uncached. The doc id is the
   * detailed Plaid enum; callers map it to the engine's `CategoryRule`.
   *
   * Prefer `get_active_cached` on hot paths; use this when you need a guaranteed
   * fresh read.
   */
  async get_active(_ctx: TraceContext): Promise<CategoryDoc[]> {
    return fetch_active();
  },

  /**
   * Gets all active category docs from the module-scope cache, refreshing on a
   * miss or after the TTL expires. Safe for read-only matching on hot paths;
   * `categories` is a slowly-changing reference collection.
   */
  async get_active_cached(_ctx: TraceContext): Promise<CategoryDoc[]> {
    const now = current_millis();
    if (cached_active && now - cache_loaded_at < CACHE_TTL_MS) {
      return cached_active;
    }
    cached_active = await fetch_active();
    cache_loaded_at = now;
    return cached_active;
  },
};

/**
 * Clears the active-category cache. Call after any write to the `categories`
 * collection so the next read reflects the change immediately rather than
 * waiting out the TTL.
 */
export function invalidate_category_cache(): void {
  cached_active = null;
  cache_loaded_at = 0;
}

/**
 * Wall-clock millis, isolated so the cache TTL check has a single source. (Kept
 * as a function rather than inline `Date.now()` so the read path is easy to test
 * with fake timers.)
 */
function current_millis(): number {
  return Date.now();
}
