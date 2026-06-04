"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.seed_categories = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const plaid_category_taxonomy_1 = require("./plaid_category_taxonomy");
exports.seed_categories = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ memory: "256MiB", timeoutSeconds: 120 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const db = (0, firestore_1.getFirestore)();
    const now = firestore_1.Timestamp.now();
    const col = db.collection("categories");
    // Find which detailed ids already exist (skip those — preserve edits).
    const existing = new Set();
    const existing_snap = await col.get();
    existing_snap.forEach((d) => existing.add(d.id));
    let created = 0;
    let skipped = 0;
    let batch = db.batch();
    let in_batch = 0;
    let index = 0;
    for (const cat of plaid_category_taxonomy_1.PLAID_SEED_CATEGORIES) {
        index++;
        if (existing.has(cat.detailed)) {
            skipped++;
            continue;
        }
        /* eslint-disable @typescript-eslint/naming-convention */
        const doc = {
            name: cat.name,
            primary_plaid_category: cat.primary,
            detailed_plaid_category: cat.detailed,
            description: "",
            type: cat.type,
            first_category: cat.primary,
            second_category: cat.detailed,
            overall_category: cat.primary,
            visible_by_default: true,
            budget_selection: cat.type === "Outflow",
            income_selection: cat.type === "Income",
            index,
            merchants: [],
            keywords: [],
            isActive: true,
            isSystemCategory: true,
            createdAt: now,
            updatedAt: now,
        };
        /* eslint-enable @typescript-eslint/naming-convention */
        // Doc id IS the detailed Plaid enum — the stable matching key.
        batch.set(col.doc(cat.detailed), doc);
        created++;
        in_batch++;
        if (in_batch >= 450) {
            await batch.commit();
            batch = db.batch();
            in_batch = 0;
        }
    }
    if (in_batch > 0) {
        await batch.commit();
    }
    console.log(`[seed_categories] created=${created}, skipped=${skipped}, ` +
        `total=${plaid_category_taxonomy_1.PLAID_SEED_CATEGORIES.length}`);
    return { success: true, created, skipped, total: plaid_category_taxonomy_1.PLAID_SEED_CATEGORIES.length };
});
//# sourceMappingURL=seed_categories.js.map