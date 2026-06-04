/**
 * Seed Categories (callable)
 *
 * Populates the `categories` collection from the Plaid DETAILED taxonomy. Each
 * category doc's id IS the detailed Plaid enum (e.g. `FOOD_AND_DRINK_GROCERIES`)
 * so budgets (`categoryIds`) and transaction splits (`plaidDetailedCategory`)
 * reference the same stable id — renaming the display `name` never breaks
 * matching.
 *
 * Idempotent: existing category docs are left untouched (so re-running is safe
 * and never clobbers an edited name). Returns how many were created vs skipped.
 *
 * @module categories/seed/seed_categories
 */
export declare const seed_categories: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    created: number;
    skipped: number;
    total: number;
}>, unknown>;
//# sourceMappingURL=seed_categories.d.ts.map