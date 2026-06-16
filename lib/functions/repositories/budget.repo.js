"use strict";
/**
 * Budget Repository
 *
 * Handles persistence for budget entities. All writes are audited.
 *
 * NOTE: This repository uses snake_case internally (BudgetEntity) but maps
 * to/from the legacy camelCase Firestore documents (the `Budget` interface in
 * src/types/index.ts) for backwards compatibility.
 *
 * @module repositories/budget
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.budget_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../types");
const audit_1 = require("../audit");
/**
 * Firestore collection name.
 */
const COLLECTION = "budgets";
/**
 * Safety cap on the per-field budget queries in `get_by_user_id`. A real user
 * has at most a few hundred budgets; this bounds the scan so a runaway/abusive
 * account can't turn an assignment read into a full-collection scan. If a query
 * ever hits the cap we log a warning (silent truncation would read as "all
 * budgets" when it isn't).
 */
const MAX_BUDGETS_PER_USER = 1000;
/**
 * Maps legacy Firestore document to BudgetEntity.
 */
function map_to_entity(doc) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    const group_ids = (_a = doc.groupIds) !== null && _a !== void 0 ? _a : [];
    return {
        id: doc.id,
        user_id: doc.userId,
        group_ids,
        is_active: doc.isActive,
        access: doc.access
            ? {
                owner_id: doc.access.ownerId,
                created_by: doc.access.createdBy,
                group_ids: doc.access.groupIds,
                is_private: doc.access.isPrivate,
            }
            : {
                owner_id: (_b = doc.ownerId) !== null && _b !== void 0 ? _b : doc.userId,
                created_by: (_c = doc.createdBy) !== null && _c !== void 0 ? _c : doc.userId,
                group_ids,
                is_private: group_ids.length === 0,
            },
        created_by: (_d = doc.createdBy) !== null && _d !== void 0 ? _d : doc.userId,
        owner_id: (_e = doc.ownerId) !== null && _e !== void 0 ? _e : doc.userId,
        is_private: (_f = doc.isPrivate) !== null && _f !== void 0 ? _f : group_ids.length === 0,
        name: doc.name,
        description: doc.description,
        amount: doc.amount,
        currency: (_g = doc.currency) !== null && _g !== void 0 ? _g : "USD",
        category_ids: (_h = doc.categoryIds) !== null && _h !== void 0 ? _h : [],
        period: (_j = doc.period) !== null && _j !== void 0 ? _j : "monthly",
        budget_type: (_k = doc.budgetType) !== null && _k !== void 0 ? _k : "recurring",
        start_date: doc.startDate,
        end_date: doc.endDate,
        spent: (_l = doc.spent) !== null && _l !== void 0 ? _l : 0,
        remaining: (_m = doc.remaining) !== null && _m !== void 0 ? _m : doc.amount,
        alert_threshold: (_o = doc.alertThreshold) !== null && _o !== void 0 ? _o : 80,
        selected_start_period: doc.selectedStartPeriod,
        end_period: doc.endPeriod,
        total_periods: doc.totalPeriods,
        active_period_range: doc.activePeriodRange
            ? {
                start_period: doc.activePeriodRange.startPeriod,
                end_period: doc.activePeriodRange.endPeriod,
            }
            : undefined,
        last_extended: doc.lastExtended,
        is_ongoing: (_p = doc.isOngoing) !== null && _p !== void 0 ? _p : true,
        budget_end_date: doc.budgetEndDate,
        is_system_everything_else: doc.isSystemEverythingElse,
        rollover_enabled: doc.rolloverEnabled,
        rollover_strategy: doc.rolloverStrategy,
        rollover_spread_periods: doc.rolloverSpreadPeriods,
        created_at: doc.createdAt,
        updated_at: doc.updatedAt,
    };
}
/**
 * Maps BudgetEntity to legacy Firestore document.
 * Preserves the legacy compatibility fields the rest of the system reads.
 */
function map_to_doc(entity) {
    var _a;
    const single_group_id = (_a = entity.group_ids[0]) !== null && _a !== void 0 ? _a : null;
    return {
        id: entity.id,
        userId: entity.user_id,
        groupIds: entity.group_ids,
        isActive: entity.is_active,
        createdAt: entity.created_at,
        updatedAt: entity.updated_at,
        createdBy: entity.created_by,
        ownerId: entity.owner_id,
        isPrivate: entity.is_private,
        access: {
            ownerId: entity.access.owner_id,
            createdBy: entity.access.created_by,
            groupIds: entity.access.group_ids,
            isPrivate: entity.access.is_private,
        },
        name: entity.name,
        description: entity.description,
        amount: entity.amount,
        currency: entity.currency,
        categoryIds: entity.category_ids,
        period: entity.period,
        budgetType: entity.budget_type,
        startDate: entity.start_date,
        endDate: entity.end_date,
        spent: entity.spent,
        remaining: entity.remaining,
        alertThreshold: entity.alert_threshold,
        selectedStartPeriod: entity.selected_start_period,
        endPeriod: entity.end_period,
        totalPeriods: entity.total_periods,
        activePeriodRange: entity.active_period_range
            ? {
                startPeriod: entity.active_period_range.start_period,
                endPeriod: entity.active_period_range.end_period,
            }
            : undefined,
        lastExtended: entity.last_extended,
        isOngoing: entity.is_ongoing,
        budgetEndDate: entity.budget_end_date,
        isSystemEverythingElse: entity.is_system_everything_else,
        rolloverEnabled: entity.rollover_enabled,
        rolloverStrategy: entity.rollover_strategy,
        rolloverSpreadPeriods: entity.rollover_spread_periods,
        // Legacy compatibility fields
        familyId: entity.is_private ? undefined : single_group_id !== null && single_group_id !== void 0 ? single_group_id : undefined,
        groupId: single_group_id,
        accessibleBy: [entity.user_id],
        memberIds: [entity.user_id],
        isShared: !entity.is_private,
    };
}
/* eslint-enable @typescript-eslint/naming-convention */
/**
 * Removes undefined values so Firestore set() does not reject them.
 */
function strip_undefined(obj) {
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
            out[key] = value;
        }
    }
    return out;
}
/**
 * Gets Firestore document reference.
 */
function doc_ref(id) {
    return (0, firestore_1.getFirestore)().collection(COLLECTION).doc(id);
}
/**
 * Budget Repository.
 * All write operations automatically create audit entries.
 */
exports.budget_repo = {
    /**
     * Generates a new budget document ID without writing.
     */
    new_id() {
        return (0, firestore_1.getFirestore)().collection(COLLECTION).doc().id;
    },
    /**
     * Gets a budget by ID.
     */
    async get_by_id(_ctx, id, options) {
        const doc = await doc_ref(id).get();
        if (!doc.exists) {
            return null;
        }
        const data = doc.data();
        if (!data.isActive && !(options === null || options === void 0 ? void 0 : options.include_deleted)) {
            return null;
        }
        // Always source the entity id from the doc ref — legacy-created docs (e.g.
        // the Everything Else budget) don't denormalize an `id` field into data.
        return map_to_entity(Object.assign(Object.assign({}, data), { id: doc.id }));
    },
    /**
     * Gets all active budgets for a user.
     *
     * Queries by both createdBy (RBAC) and userId (legacy) and dedupes,
     * matching the legacy category-ownership behavior.
     */
    async get_by_user_id(_ctx, user_id, options) {
        var _a;
        const db = (0, firestore_1.getFirestore)();
        const include_deleted = (_a = options === null || options === void 0 ? void 0 : options.include_deleted) !== null && _a !== void 0 ? _a : false;
        const build = (field) => {
            let q = db.collection(COLLECTION).where(field, "==", user_id);
            if (!include_deleted) {
                q = q.where("isActive", "==", true);
            }
            return q.limit(MAX_BUDGETS_PER_USER);
        };
        const [created_by_snap, user_id_snap] = await Promise.all([
            build("createdBy").get(),
            build("userId").get(),
        ]);
        for (const [field, snap] of [
            ["createdBy", created_by_snap],
            ["userId", user_id_snap],
        ]) {
            if (snap.size >= MAX_BUDGETS_PER_USER) {
                console.warn(`[budget_repo.get_by_user_id] user=${user_id} hit the ${MAX_BUDGETS_PER_USER} ` +
                    `budget cap on "${field}" — results may be truncated`);
            }
        }
        const by_id = new Map();
        for (const snap of [created_by_snap, user_id_snap]) {
            snap.docs.forEach((doc) => {
                if (!by_id.has(doc.id)) {
                    // Source the id from the doc ref — legacy-created docs (Everything
                    // Else) don't store an `id` field in their data.
                    by_id.set(doc.id, map_to_entity(Object.assign(Object.assign({}, doc.data()), { id: doc.id })));
                }
            });
        }
        return Array.from(by_id.values());
    },
    /**
     * Counts active budgets for a user (used for the budget limit).
     */
    async count_by_user_id(_ctx, user_id) {
        const budgets = await this.get_by_user_id(_ctx, user_id);
        return budgets.length;
    },
    /**
     * Finds the user's system "Everything Else" budget, if any.
     */
    async find_everything_else(_ctx, user_id) {
        var _a;
        const budgets = await this.get_by_user_id(_ctx, user_id);
        return (_a = budgets.find((b) => b.is_system_everything_else === true)) !== null && _a !== void 0 ? _a : null;
    },
    /**
     * Atomically removes category IDs from a budget's categoryIds array.
     * Idempotent: removing an absent category is a no-op.
     */
    async remove_category_ids(ctx, id, category_ids, user_id) {
        if (category_ids.length === 0) {
            return (0, types_1.create_write_result)("budget", id, "merge", { id }, { id });
        }
        // Read-modify-REPLACE: recompute the full categoryIds array and set it,
        // never a blind FieldValue.arrayRemove. Atomic within this one budget
        // aggregate (the only guide-sanctioned use of a Firestore transaction).
        const remove_set = new Set(category_ids);
        await (0, firestore_1.getFirestore)().runTransaction(async (tx) => {
            var _a, _b;
            const snap = await tx.get(doc_ref(id));
            const current = (_b = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.categoryIds) !== null && _b !== void 0 ? _b : [];
            const next = current.filter((c) => !remove_set.has(c));
            /* eslint-disable @typescript-eslint/naming-convention */
            tx.update(doc_ref(id), { categoryIds: next, updatedAt: firestore_1.Timestamp.now() });
            /* eslint-enable @typescript-eslint/naming-convention */
        });
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "update",
            entity_type: "budget",
            entity_id: id,
            before: null,
            after: { removed_category_ids: category_ids },
            trace_id: ctx.trace_id,
            metadata: { source: "api", context: { category_transfer: "remove" } },
        });
        return (0, types_1.create_write_result)("budget", id, "merge", { category_ids: "before" }, { removed: category_ids });
    },
    /**
     * Atomically adds category IDs to a budget's categoryIds array.
     * Idempotent: adding an existing category is a no-op.
     */
    async add_category_ids(ctx, id, category_ids, user_id) {
        if (category_ids.length === 0) {
            return (0, types_1.create_write_result)("budget", id, "merge", { id }, { id });
        }
        // Read-modify-REPLACE: recompute the deduped categoryIds array and set it,
        // never a blind FieldValue.arrayUnion. Atomic within this one budget aggregate.
        await (0, firestore_1.getFirestore)().runTransaction(async (tx) => {
            var _a, _b;
            const snap = await tx.get(doc_ref(id));
            const current = (_b = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.categoryIds) !== null && _b !== void 0 ? _b : [];
            const next = [...new Set([...current, ...category_ids])];
            /* eslint-disable @typescript-eslint/naming-convention */
            tx.update(doc_ref(id), { categoryIds: next, updatedAt: firestore_1.Timestamp.now() });
            /* eslint-enable @typescript-eslint/naming-convention */
        });
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "update",
            entity_type: "budget",
            entity_id: id,
            before: null,
            after: { added_category_ids: category_ids },
            trace_id: ctx.trace_id,
            metadata: { source: "api", context: { category_transfer: "add" } },
        });
        return (0, types_1.create_write_result)("budget", id, "merge", { category_ids: "before" }, { added: category_ids });
    },
    /**
     * Writes back period-range metadata after budget periods are generated.
     * Mirrors the legacy `updateBudgetPeriodRange`: sets activePeriodRange +
     * lastExtended for all budgets, and the extension flags for recurring ones.
     */
    async set_period_range(ctx, id, start_period_id, end_period_id, generation_end, is_recurring, user_id) {
        const now = firestore_1.Timestamp.now();
        /* eslint-disable @typescript-eslint/naming-convention */
        const update_data = {
            activePeriodRange: {
                startPeriod: start_period_id,
                endPeriod: end_period_id,
            },
            lastExtended: now,
            updatedAt: now,
        };
        if (is_recurring) {
            update_data.periodsGeneratedUntil = generation_end;
            update_data.canExtendPeriods = true;
            update_data.needsScheduledExtension = true;
        }
        /* eslint-enable @typescript-eslint/naming-convention */
        await doc_ref(id).update(update_data);
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "update",
            entity_type: "budget",
            entity_id: id,
            before: null,
            after: update_data,
            trace_id: ctx.trace_id,
            metadata: { source: "api", context: { period_range: true } },
        });
        return (0, types_1.create_write_result)("budget", id, "merge", { active_period_range: "before" }, update_data);
    },
    /**
     * Saves a budget (create or update).
     */
    async save(ctx, entity) {
        if (!entity.id) {
            throw new Error("Budget ID is required");
        }
        if (!entity.user_id) {
            throw new Error("User ID is required");
        }
        const before_doc = await doc_ref(entity.id).get();
        const before = before_doc.exists
            ? before_doc.data()
            : null;
        const entity_to_save = Object.assign(Object.assign({}, entity), { updated_at: firestore_1.Timestamp.now() });
        const doc_data = strip_undefined(map_to_doc(entity_to_save));
        await doc_ref(entity.id).set(doc_data);
        (0, audit_1.record_audit_entry_async)({
            user_id: entity.user_id,
            action: before ? "update" : "create",
            entity_type: "budget",
            entity_id: entity.id,
            before: before,
            after: doc_data,
            trace_id: ctx.trace_id,
            metadata: { source: "api" },
        });
        return (0, types_1.create_write_result)("budget", entity.id, "replace", before, doc_data);
    },
    /**
     * Updates only the category ownership for a budget (claim/release).
     * Used by the cascade job to transfer categories without a full rewrite.
     */
    async set_category_ids(ctx, id, category_ids, user_id) {
        const before_doc = await doc_ref(id).get();
        if (!before_doc.exists) {
            throw new Error(`Budget ${id} not found`);
        }
        const before = before_doc.data();
        const now = firestore_1.Timestamp.now();
        /* eslint-disable @typescript-eslint/naming-convention */
        const update_data = {
            categoryIds: category_ids,
            updatedAt: now,
        };
        /* eslint-enable @typescript-eslint/naming-convention */
        await doc_ref(id).update(update_data);
        const after = Object.assign(Object.assign({}, before), update_data);
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "update",
            entity_type: "budget",
            entity_id: id,
            before: before,
            after: after,
            trace_id: ctx.trace_id,
            metadata: { source: "api", context: { category_transfer: true } },
        });
        return (0, types_1.create_write_result)("budget", id, "merge", before, after);
    },
    /**
     * Hard-deletes a budget document.
     * Matches the legacy delete semantics (the cascade job removes periods and
     * reassigns transaction splits separately).
     */
    async hard_delete(ctx, id, user_id) {
        const before_doc = await doc_ref(id).get();
        if (!before_doc.exists) {
            throw new Error(`Budget ${id} not found`);
        }
        const before = before_doc.data();
        await doc_ref(id).delete();
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "delete",
            entity_type: "budget",
            entity_id: id,
            before: before,
            after: null,
            trace_id: ctx.trace_id,
            metadata: { source: "api" },
        });
        return (0, types_1.create_write_result)("budget", id, "replace", before, null);
    },
    /**
     * Checks if a budget exists.
     */
    async exists(_ctx, id) {
        const doc = await doc_ref(id).get();
        return doc.exists;
    },
};
//# sourceMappingURL=budget.repo.js.map