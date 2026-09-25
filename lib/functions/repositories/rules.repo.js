"use strict";
/**
 * Rules Repository — persistence for the Transaction Rules Engine ("Rule Book").
 *
 * One Firestore doc per rule in the `rules` collection (no per-user-doc size ceiling / write
 * contention). Top-level fields are camelCase (`userId`/`isActive`/`priority`) for the query index;
 * the nested `conditions`/`actions` blobs use the domain shape (never queried, only loaded).
 *
 * COST: `get_active_rules` is the ONLY read the Rules Engine adds to the ingest path, and it runs
 * ONCE per sync batch (loaded above the per-txn loop — never per transaction). See the project's
 * Read-Cost Plan. Requires the composite index `(userId, isActive, priority)`.
 *
 * @module repositories/rules
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rules_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const COLLECTION = "rules";
const col = () => (0, firestore_1.getFirestore)().collection(COLLECTION);
exports.rules_repo = {
    /**
     * Loads a user's ACTIVE rules, ordered by `priority` ascending (Rule Book list order).
     * Call this ONCE per sync batch; evaluate the returned rules against the in-memory transactions.
     */
    async get_active_rules(_ctx, user_id) {
        const snap = await col()
            .where("userId", "==", user_id)
            .where("isActive", "==", true)
            .orderBy("priority", "asc")
            .get();
        return snap.docs.map((d) => map_to_domain(d.id, d.data()));
    },
    /**
     * Loads ALL of a user's rules (active + inactive), priority-ordered — for the Rule Book UI.
     * Single-field `userId` filter (no composite index needed) + in-memory priority sort — the set is
     * tiny (≤ MAX_RULES_PER_USER) and this avoids a `(userId, priority)` index just for the UI list.
     */
    async list_rules(_ctx, user_id) {
        const snap = await col().where("userId", "==", user_id).get();
        return snap.docs
            .map((d) => map_to_domain(d.id, d.data()))
            .sort((a, b) => a.priority - b.priority);
    },
    /** Counts a user's rules (for the per-user cap). */
    async count_rules(_ctx, user_id) {
        const agg = await col().where("userId", "==", user_id).count().get();
        return agg.data().count;
    },
    /** Creates a rule doc (camelCase top-level fields for the index; domain-shape nested blobs). */
    async create_rule(_ctx, user_id, rule) {
        const now = firestore_1.Timestamp.now();
        /* eslint-disable @typescript-eslint/naming-convention */
        const ref = await col().add({
            userId: user_id,
            name: rule.name,
            conditions: rule.conditions,
            actions: rule.actions,
            priority: rule.priority,
            isActive: rule.is_active,
            createdAt: now,
            updatedAt: now,
        });
        /* eslint-enable @typescript-eslint/naming-convention */
        return ref.id;
    },
    /** Loads one rule (ownership-checked by the caller). */
    async get_rule(_ctx, rule_id) {
        const doc = await col().doc(rule_id).get();
        return doc.exists ? map_to_domain(doc.id, doc.data()) : null;
    },
    /** Patches a rule's editable fields (camelCase). Only provided fields are written. */
    async update_rule(_ctx, rule_id, patch) {
        /* eslint-disable @typescript-eslint/naming-convention */
        const update = { updatedAt: firestore_1.Timestamp.now() };
        if (patch.name !== undefined)
            update.name = patch.name;
        if (patch.conditions !== undefined)
            update.conditions = patch.conditions;
        if (patch.actions !== undefined)
            update.actions = patch.actions;
        if (patch.priority !== undefined)
            update.priority = patch.priority;
        if (patch.is_active !== undefined)
            update.isActive = patch.is_active;
        /* eslint-enable @typescript-eslint/naming-convention */
        await col().doc(rule_id).update(update);
    },
    /** Hard-deletes a rule (rules carry no history to preserve). */
    async delete_rule(_ctx, rule_id) {
        await col().doc(rule_id).delete();
    },
    /**
     * Removes a deleted tag id from all of the user's rules: drops any `has tag <id>` conditions and
     * strips `<id>` from `add_tag` actions. A rule left with zero conditions or zero actions is
     * DEACTIVATED (never left condition-less — that would match every transaction). Returns the count
     * of rules changed. Bounded batch (450-doc commits); rules are few (≤ MAX_RULES_PER_USER).
     */
    async strip_tag(_ctx, user_id, tag_id) {
        const db = (0, firestore_1.getFirestore)();
        const snap = await col().where("userId", "==", user_id).get();
        let batch = db.batch();
        let pending = 0;
        let count = 0;
        for (const doc of snap.docs) {
            const rule = map_to_domain(doc.id, doc.data());
            const stripped = strip_tag_from_rule(rule, tag_id);
            if (!stripped.changed)
                continue;
            const still_valid = count_conditions_in(stripped.conditions) > 0 && has_any_action_in(stripped.actions);
            /* eslint-disable @typescript-eslint/naming-convention */
            batch.update(doc.ref, {
                conditions: stripped.conditions,
                actions: stripped.actions,
                isActive: still_valid ? rule.is_active : false,
                updatedAt: firestore_1.Timestamp.now(),
            });
            /* eslint-enable @typescript-eslint/naming-convention */
            count++;
            pending++;
            if (pending === 450) {
                await batch.commit();
                batch = db.batch();
                pending = 0;
            }
        }
        if (pending > 0) {
            await batch.commit();
        }
        return count;
    },
};
/** Pure: strip a tag id from a rule's conditions (`has tag`) + `add_tag` action. */
function strip_tag_from_rule(rule, tag_id) {
    let changed = false;
    const strip_group = (group) => {
        var _a;
        const conditions = group.conditions.filter((c) => {
            const drop = c.variable === "tag" && String(c.value) === tag_id;
            if (drop)
                changed = true;
            return !drop;
        });
        const nested = ((_a = group.nested) !== null && _a !== void 0 ? _a : []).map(strip_group);
        return Object.assign({ op: group.op, conditions }, (nested.length > 0 ? { nested } : {}));
    };
    const conditions = strip_group(rule.conditions);
    let actions = rule.actions;
    if (rule.actions.add_tag && rule.actions.add_tag.includes(tag_id)) {
        const next = rule.actions.add_tag.filter((id) => id !== tag_id);
        changed = true;
        actions = Object.assign({}, rule.actions);
        if (next.length > 0) {
            actions.add_tag = next;
        }
        else {
            delete actions.add_tag;
        }
    }
    return { conditions, actions, changed };
}
/** Pure: total conditions in a group tree (direct + nested). */
function count_conditions_in(group) {
    var _a;
    return (group.conditions.length +
        ((_a = group.nested) !== null && _a !== void 0 ? _a : []).reduce((sum, g) => sum + count_conditions_in(g), 0));
}
/** Pure: true when the actions object still has at least one meaningful action set. */
function has_any_action_in(actions) {
    return Object.values(actions).some((v) => Array.isArray(v) ? v.length > 0 : v !== undefined && v !== false);
}
/** Map a Firestore rule doc to the domain `Rule`. Malformed docs degrade to never-match. */
function map_to_domain(id, data) {
    var _a, _b, _c, _d;
    /* eslint-disable @typescript-eslint/naming-convention */
    // camelCase = the stored Firestore field names (query/index convention).
    const d = data;
    /* eslint-enable @typescript-eslint/naming-convention */
    return {
        id,
        user_id: (_a = d.userId) !== null && _a !== void 0 ? _a : "",
        name: (_b = d.name) !== null && _b !== void 0 ? _b : "",
        // An empty group never matches — a safe default if a doc is malformed.
        conditions: (_c = d.conditions) !== null && _c !== void 0 ? _c : { op: "AND", conditions: [] },
        actions: (_d = d.actions) !== null && _d !== void 0 ? _d : {},
        priority: typeof d.priority === "number" ? d.priority : 0,
        is_active: d.isActive === true,
    };
}
//# sourceMappingURL=rules.repo.js.map