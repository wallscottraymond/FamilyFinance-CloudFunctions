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

import { getFirestore } from "firebase-admin/firestore";
import { TraceContext } from "../types";

const COLLECTION = "categories";

export const category_repo = {
  /**
   * Gets all active category docs (raw data + id). The doc id is the detailed
   * Plaid enum; callers map it to the engine's `CategoryRule`.
   */
  async get_active(
    _ctx: TraceContext
  ): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
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
  },
};
