/**
 * Category Repository
 *
 * READ-ONLY persistence boundary for the `categories` reference collection.
 * Each category doc id is a Plaid DETAILED enum (e.g. FOOD_AND_DRINK_GROCERIES);
 * the assignment engine matches splits against these and a category's
 * merchant/keyword upgrade rules.
 *
 * @module repositories/category
 */
import { TraceContext } from "../types";
export declare const category_repo: {
    /**
     * Gets all active category docs (raw data + id). The doc id is the detailed
     * Plaid enum; callers map it to the engine's `CategoryRule`.
     */
    get_active(_ctx: TraceContext): Promise<Array<{
        id: string;
        data: Record<string, unknown>;
    }>>;
};
//# sourceMappingURL=category.repo.d.ts.map