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
import { TraceContext } from "../types";
/** Active-category cache shape. */
type CategoryDoc = {
    id: string;
    data: Record<string, unknown>;
};
export declare const category_repo: {
    /**
     * Gets all active category docs (raw data + id), uncached. The doc id is the
     * detailed Plaid enum; callers map it to the engine's `CategoryRule`.
     *
     * Prefer `get_active_cached` on hot paths; use this when you need a guaranteed
     * fresh read.
     */
    get_active(_ctx: TraceContext): Promise<CategoryDoc[]>;
    /**
     * Gets all active category docs from the module-scope cache, refreshing on a
     * miss or after the TTL expires. Safe for read-only matching on hot paths;
     * `categories` is a slowly-changing reference collection.
     */
    get_active_cached(_ctx: TraceContext): Promise<CategoryDoc[]>;
};
/**
 * Clears the active-category cache. Call after any write to the `categories`
 * collection so the next read reflects the change immediately rather than
 * waiting out the TTL.
 */
export declare function invalidate_category_cache(): void;
export {};
//# sourceMappingURL=category.repo.d.ts.map