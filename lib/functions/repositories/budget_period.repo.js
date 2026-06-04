"use strict";
/**
 * Budget Period Repository
 *
 * Persistence for budget_periods. Scoped to what the budget CRUD migration
 * needs: listing and batch-deleting periods for a budget (the delete cascade).
 *
 * Period GENERATION (prime/non-prime allocation from source_periods) remains
 * owned by the existing budget period engine and is invoked from the create
 * cascade job — it is intentionally not reimplemented here.
 *
 * @module repositories/budget_period
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.budget_period_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../types");
/**
 * Firestore collection name.
 */
const COLLECTION = "budget_periods";
/* eslint-enable @typescript-eslint/naming-convention */
/**
 * Inclusive UTC-normalized day count between two timestamps.
 */
function day_count(start, end) {
    const s = start.toDate();
    const e = end.toDate();
    const s_utc = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
    const e_utc = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
    return Math.round((e_utc - s_utc) / (1000 * 60 * 60 * 24)) + 1;
}
/**
 * Maps a legacy budget period document to the entity.
 */
function map_to_entity(doc) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const allocated = (_a = doc.allocatedAmount) !== null && _a !== void 0 ? _a : 0;
    const rolled_over = (_b = doc.rolledOverAmount) !== null && _b !== void 0 ? _b : 0;
    const spent = (_c = doc.spent) !== null && _c !== void 0 ? _c : 0;
    return {
        id: doc.id,
        budget_id: doc.budgetId,
        user_id: (_d = doc.userId) !== null && _d !== void 0 ? _d : "",
        group_ids: (_e = doc.groupIds) !== null && _e !== void 0 ? _e : [],
        category_ids: (_f = doc.categoryIds) !== null && _f !== void 0 ? _f : [],
        period_id: doc.periodId,
        period_type: (_g = doc.periodType) !== null && _g !== void 0 ? _g : "monthly",
        allocated_amount: allocated,
        rolled_over_amount: rolled_over,
        effective_amount: allocated + rolled_over,
        spent,
        remaining: allocated + rolled_over - spent,
        daily_rate: (_h = doc.dailyRate) !== null && _h !== void 0 ? _h : 0,
        start_date: doc.periodStart,
        end_date: doc.periodEnd,
        is_active: (_j = doc.isActive) !== null && _j !== void 0 ? _j : true,
        created_at: (_l = (_k = doc.createdAt) !== null && _k !== void 0 ? _k : doc.updatedAt) !== null && _l !== void 0 ? _l : firestore_1.Timestamp.now(),
        updated_at: (_m = doc.updatedAt) !== null && _m !== void 0 ? _m : firestore_1.Timestamp.now(),
    };
}
/**
 * Budget Period Repository.
 */
exports.budget_period_repo = {
    /**
     * Returns the document IDs of all periods for a budget.
     * Used by the delete resolver to size the cascade.
     */
    async get_ids_by_budget_id(_ctx, budget_id) {
        const snapshot = await (0, firestore_1.getFirestore)()
            .collection(COLLECTION)
            .where("budgetId", "==", budget_id)
            .select()
            .get();
        return snapshot.docs.map((doc) => doc.id);
    },
    /**
     * Returns all periods for a budget as entities.
     */
    async get_by_budget_id(_ctx, budget_id) {
        const snapshot = await (0, firestore_1.getFirestore)()
            .collection(COLLECTION)
            .where("budgetId", "==", budget_id)
            .get();
        return snapshot.docs.map((doc) => map_to_entity(doc.data()));
    },
    /**
     * Gets the raw doc data + id for a set of period IDs (missing docs skipped).
     * READ-ONLY — used by the summary resolver to group periods for recompute.
     */
    async get_by_ids(_ctx, period_ids) {
        const docs = await Promise.all(period_ids.map((id) => (0, firestore_1.getFirestore)().collection(COLLECTION).doc(id).get()));
        return docs
            .filter((doc) => doc.exists)
            .map((doc) => ({ id: doc.id, data: doc.data() }));
    },
    /**
     * Hard-deletes all periods for a budget in batches (max 500 per batch).
     * Returns one WriteResult per deleted period.
     */
    async delete_by_budget_id(_ctx, budget_id) {
        const ids = await this.get_ids_by_budget_id(_ctx, budget_id);
        return this.delete_by_ids(_ctx, ids);
    },
    /**
     * Hard-deletes periods by document ID in batches (max 500 per batch).
     */
    async delete_by_ids(_ctx, ids) {
        if (ids.length === 0) {
            return [];
        }
        const db = (0, firestore_1.getFirestore)();
        const results = [];
        const chunks = (0, types_1.chunk_for_batch)(ids);
        for (const chunk of chunks) {
            const batch = db.batch();
            for (const id of chunk) {
                batch.delete(db.collection(COLLECTION).doc(id));
                results.push((0, types_1.create_write_result)("budget_period", id, "replace", { id }, null));
            }
            await batch.commit();
        }
        return results;
    },
    /**
     * Batch-saves generated budget periods (max 500 per batch).
     * Maps each entity to the legacy budget_periods document, defaulting the
     * fields the rest of the system reads (denormalized name, checklist, flags).
     *
     * @param ctx - Trace context
     * @param periods - Period entities to persist
     * @param budget_name - Denormalized budget name to store on each period
     */
    async save_batch(_ctx, periods, budget_name) {
        var _a, _b, _c, _d, _e, _f;
        if (periods.length === 0) {
            return [];
        }
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        const results = [];
        const chunks = (0, types_1.chunk_for_batch)(periods);
        for (const chunk of chunks) {
            const batch = db.batch();
            for (const period of chunk) {
                const days = (_a = period.days_in_period) !== null && _a !== void 0 ? _a : day_count(period.start_date, period.end_date);
                // Map the prime/non-prime overlap breakdown to its camelCase document
                // shape (consumed by the mobile non-prime editor). A period is prime when
                // it has no breakdown entries (1:1 with the budget cadence).
                const prime_breakdown = ((_b = period.prime_period_breakdown) !== null && _b !== void 0 ? _b : []).map((b) => ({
                    /* eslint-disable @typescript-eslint/naming-convention */
                    primePeriodId: b.prime_period_id,
                    sourcePeriodId: b.source_period_id,
                    daysContributed: b.days_contributed,
                    dailyRate: b.daily_rate,
                    amountContributed: b.amount_contributed,
                    overlapStart: b.overlap_start,
                    overlapEnd: b.overlap_end,
                    /* eslint-enable @typescript-eslint/naming-convention */
                }));
                const is_prime = (_c = period.is_prime) !== null && _c !== void 0 ? _c : prime_breakdown.length === 0;
                /* eslint-disable @typescript-eslint/naming-convention */
                const doc_data = {
                    id: period.id,
                    budgetId: period.budget_id,
                    budgetName: budget_name,
                    categoryIds: (_d = period.category_ids) !== null && _d !== void 0 ? _d : [],
                    userId: period.user_id,
                    groupIds: period.group_ids,
                    periodId: period.period_id,
                    sourcePeriodId: period.period_id,
                    periodType: period.period_type,
                    periodStart: period.start_date,
                    periodEnd: period.end_date,
                    allocatedAmount: period.allocated_amount,
                    originalAmount: period.allocated_amount,
                    rolledOverAmount: period.rolled_over_amount,
                    spent: period.spent,
                    remaining: period.remaining,
                    dailyRate: period.daily_rate,
                    daysInPeriod: days,
                    isPrime: is_prime,
                    primePeriodIds: (_e = period.prime_period_ids) !== null && _e !== void 0 ? _e : [],
                    primePeriodBreakdown: prime_breakdown,
                    isModified: false,
                    checklistItems: [],
                    lastCalculated: now,
                    isActive: period.is_active,
                    createdAt: (_f = period.created_at) !== null && _f !== void 0 ? _f : now,
                    updatedAt: now,
                };
                /* eslint-enable @typescript-eslint/naming-convention */
                batch.set(db.collection(COLLECTION).doc(period.id), doc_data);
                results.push((0, types_1.create_write_result)("budget_period", period.id, "replace", null, doc_data));
            }
            await batch.commit();
        }
        return results;
    },
    /**
     * Recomputes SPENT fields IN PLACE on existing periods (max 500 per batch).
     * Used by the spend pipeline (invalidation-based): writes `spent`,
     * `pendingSpent`, and `remaining` while preserving everything else on the
     * period (allocation, notes, checklist, etc.). NOT an increment.
     */
    async update_spent(_ctx, updates) {
        if (updates.length === 0) {
            return [];
        }
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        const results = [];
        const chunks = (0, types_1.chunk_for_batch)(updates);
        for (const chunk of chunks) {
            const batch = db.batch();
            for (const u of chunk) {
                /* eslint-disable @typescript-eslint/naming-convention */
                const update_data = {
                    spent: u.spent,
                    pendingSpent: u.pending_spent,
                    remaining: u.remaining,
                    lastCalculated: now,
                    updatedAt: now,
                };
                /* eslint-enable @typescript-eslint/naming-convention */
                batch.update(db.collection(COLLECTION).doc(u.id), update_data);
                results.push((0, types_1.create_write_result)("budget_period", u.id, "merge", { id: u.id }, update_data));
            }
            await batch.commit();
        }
        return results;
    },
    /**
     * Updates allocation fields IN PLACE on existing periods (max 500 per batch).
     * Used when a budget's amount changes: recomputes allocatedAmount /
     * originalAmount / remaining / dailyRate while preserving everything else on
     * the period (userNotes, checklistItems, modifiedAmount, spent, etc.).
     */
    async update_allocations(_ctx, updates) {
        if (updates.length === 0) {
            return [];
        }
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        const results = [];
        const chunks = (0, types_1.chunk_for_batch)(updates);
        for (const chunk of chunks) {
            const batch = db.batch();
            for (const u of chunk) {
                /* eslint-disable @typescript-eslint/naming-convention */
                const update_data = {
                    allocatedAmount: u.allocated_amount,
                    originalAmount: u.allocated_amount,
                    remaining: u.remaining,
                    dailyRate: u.daily_rate,
                    lastCalculated: now,
                    updatedAt: now,
                };
                // Refresh the prime/non-prime overlap breakdown when recomputed, so it
                // stays consistent with the new amount (kept off the document when the
                // caller doesn't supply it, to avoid clobbering existing values).
                if (u.is_prime !== undefined) {
                    update_data.isPrime = u.is_prime;
                }
                if (u.prime_period_ids !== undefined) {
                    update_data.primePeriodIds = u.prime_period_ids;
                }
                if (u.prime_period_breakdown !== undefined) {
                    update_data.primePeriodBreakdown = u.prime_period_breakdown.map((b) => ({
                        primePeriodId: b.prime_period_id,
                        sourcePeriodId: b.source_period_id,
                        daysContributed: b.days_contributed,
                        dailyRate: b.daily_rate,
                        amountContributed: b.amount_contributed,
                        overlapStart: b.overlap_start,
                        overlapEnd: b.overlap_end,
                    }));
                }
                /* eslint-enable @typescript-eslint/naming-convention */
                batch.update(db.collection(COLLECTION).doc(u.id), update_data);
                results.push((0, types_1.create_write_result)("budget_period", u.id, "merge", { id: u.id }, update_data));
            }
            await batch.commit();
        }
        return results;
    },
    /**
     * Updates the denormalized budgetName on the given periods (max 500 per
     * batch). Used when a budget is renamed. Preserves all other period fields.
     */
    async update_names(_ctx, period_ids, budget_name) {
        if (period_ids.length === 0) {
            return [];
        }
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        const results = [];
        const chunks = (0, types_1.chunk_for_batch)(period_ids);
        for (const chunk of chunks) {
            const batch = db.batch();
            for (const id of chunk) {
                /* eslint-disable @typescript-eslint/naming-convention */
                const update_data = { budgetName: budget_name, updatedAt: now };
                /* eslint-enable @typescript-eslint/naming-convention */
                batch.update(db.collection(COLLECTION).doc(id), update_data);
                results.push((0, types_1.create_write_result)("budget_period", id, "merge", { id }, update_data));
            }
            await batch.commit();
        }
        return results;
    },
    /**
     * Counts periods for a budget.
     */
    async count_by_budget_id(_ctx, budget_id) {
        const snapshot = await (0, firestore_1.getFirestore)()
            .collection(COLLECTION)
            .where("budgetId", "==", budget_id)
            .count()
            .get();
        return snapshot.data().count;
    },
};
//# sourceMappingURL=budget_period.repo.js.map