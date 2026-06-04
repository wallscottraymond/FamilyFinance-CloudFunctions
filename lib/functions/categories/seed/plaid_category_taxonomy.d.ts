/**
 * Plaid personal_finance_category taxonomy (DETAILED level).
 *
 * The source of truth for seeding the `categories` collection. Each detailed
 * category becomes one category doc whose **document id IS the detailed enum**
 * (e.g. `FOOD_AND_DRINK_GROCERIES`). Budgets store these enums in `categoryIds`
 * and transaction splits carry the same enum in `plaidDetailedCategory`, so the
 * assignment engine matches them directly. The display `name` is editable —
 * renaming never breaks matching because the stable id is the enum.
 *
 * @module categories/seed/plaid_category_taxonomy
 */
/** A flat, seedable category derived from the taxonomy. */
export interface SeedCategory {
    /** Detailed Plaid enum — used as the Firestore document id. */
    detailed: string;
    primary: string;
    /** Humanized display name (editable post-seed). */
    name: string;
    type: "Income" | "Outflow";
}
/**
 * The full flat list of seed categories (one per Plaid detailed enum).
 * `name` defaults to "Primary: Suffix" (e.g. "Food And Drink: Groceries").
 */
export declare const PLAID_SEED_CATEGORIES: SeedCategory[];
//# sourceMappingURL=plaid_category_taxonomy.d.ts.map