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
import { CategoryRule } from "./match_category.service";
/** The category collection, reduced to what resolution needs. Built once per batch / request. */
export interface CategoryCatalog {
    /** Plaid detailed code (= category doc id) → its slugs. */
    slugs_by_plaid: Record<string, {
        overall_category_id: string | null;
        first_category_id: string | null;
    }>;
    /** Merchant / keyword rules (from the collection's `merchants` / `keywords`). */
    rules: CategoryRule[];
    /** first slug → one Plaid code under it (gives a user pick its income / transfer meaning). */
    plaid_by_first: Record<string, string>;
    /** first slug → its overall slug. */
    overall_by_first: Record<string, string | null>;
    /** lower-cased `first_category` display name → first slug (only to read legacy data that
     *  stored a display name; never used to write). */
    first_by_name: Record<string, string>;
}
/** A category doc as the collection stores it (id = Plaid detailed code). */
export interface CategoryDocForCatalog {
    id: string;
    data: Record<string, unknown>;
}
export declare function build_category_catalog(docs: CategoryDocForCatalog[]): CategoryCatalog;
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
}
export declare function resolve_split_category(input: SplitCategoryInput, catalog: CategoryCatalog): ResolvedSplitCategory;
//# sourceMappingURL=split_category.service.d.ts.map