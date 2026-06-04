"use strict";
/**
 * Create Budget Resolver
 *
 * READ-ONLY impact analysis for creating a budget. Resolves currency, sharing
 * groups, the user's budget count, current category ownership, and the
 * Everything Else budget. No mutations.
 *
 * @module resolvers/budgets/create_budget
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_create_budget_dependencies = resolve_create_budget_dependencies;
const firestore_1 = require("firebase-admin/firestore");
const observability_1 = require("../../observability");
const budget_repo_1 = require("../../repositories/budget.repo");
/**
 * Resolves dependencies for creating a budget.
 *
 * @param ctx - Trace context
 * @param user_id - User creating the budget
 * @param input - Normalized create input
 */
async function resolve_create_budget_dependencies(ctx, user_id, input) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const span = (0, observability_1.create_span)(ctx, "resolver", "resolve_create_budget_dependencies");
    (0, observability_1.log_operation_start)(span, user_id);
    const db = (0, firestore_1.getFirestore)();
    // 1. Resolve currency + family from the user document.
    const user_doc = await db.collection("users").doc(user_id).get();
    const user_data = (_a = user_doc.data()) !== null && _a !== void 0 ? _a : {};
    const family_id = user_data.familyId;
    let currency = (_c = (_b = user_data.preferences) === null || _b === void 0 ? void 0 : _b.currency) !== null && _c !== void 0 ? _c : "USD";
    let group_ids = [];
    if (input.is_shared && family_id) {
        group_ids = [family_id];
        const family_doc = await db.collection("families").doc(family_id).get();
        currency = (_f = (_e = (_d = family_doc.data()) === null || _d === void 0 ? void 0 : _d.settings) === null || _e === void 0 ? void 0 : _e.currency) !== null && _f !== void 0 ? _f : currency;
    }
    else if (input.group_id) {
        group_ids = [input.group_id];
    }
    // 2. Load the user's active budgets once (limit count + ownership map).
    const budgets = await budget_repo_1.budget_repo.get_by_user_id(ctx, user_id);
    const existing_budget_count = budgets.length;
    const everything_else = (_g = budgets.find((b) => b.is_system_everything_else === true)) !== null && _g !== void 0 ? _g : null;
    // 3. Build the ownership map for the requested categories only.
    const category_owners = {};
    for (const category_id of input.category_ids) {
        category_owners[category_id] = null;
    }
    for (const budget of budgets) {
        if (budget.is_system_everything_else) {
            continue;
        }
        for (const category_id of budget.category_ids) {
            if (category_id in category_owners) {
                category_owners[category_id] = budget.id;
            }
        }
    }
    (0, observability_1.log_operation_success)(span, user_id);
    return {
        currency,
        group_ids,
        existing_budget_count,
        category_owners,
        everything_else_budget_id: (_h = everything_else === null || everything_else === void 0 ? void 0 : everything_else.id) !== null && _h !== void 0 ? _h : null,
    };
}
//# sourceMappingURL=create_budget.resolver.js.map