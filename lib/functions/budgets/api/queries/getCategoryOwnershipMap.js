"use strict";
/**
 * Get Category Ownership Map (callable)
 *
 * Returns which budget owns each category IN A VIEW (canon A3 — one budget per category per
 * view): the caller's own budgets (Me), or a group's when `{ groupId }` is passed (members only). Consumed by the mobile
 * app via `httpsCallable('getCategoryOwnershipMap')` — so this MUST be an `onCall`, not an
 * `onRequest` (the previous onRequest silently failed the callable protocol → the budget-wizard
 * grey-out never received ownership data).
 *
 * Response:
 * - ownership: categoryId (detailed doc id) → budgetId (null if unassigned)
 * - ownershipByFirst: firstCategoryId → owning non-EE budgetId (Phase 5 grey-out)
 * - budgetNames / categoryNames / firstCategoryNames: display maps
 * - everythingElseBudgetId, unassignedCount, totalCategories
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCategoryOwnershipMap = void 0;
const https_1 = require("firebase-functions/v2/https");
const categoryOwnership_1 = require("../../utils/categoryOwnership");
const sharing_1 = require("../../../repositories/sharing");
const group_service_1 = require("../../../domain/sharing/group.service");
const budget_view_service_1 = require("../../../domain/sharing/budget_view.service");
exports.getCategoryOwnershipMap = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ region: "us-central1", memory: "256MiB", timeoutSeconds: 30 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const callerId = request.auth.uid;
    const groupId = (_a = request.data) === null || _a === void 0 ? void 0 : _a.groupId;
    let userId = callerId; // the view's owner key
    if (groupId) {
        const group = await sharing_1.group_repo.get({ trace_id: "ownership", span_id: "ownership" }, groupId);
        if (!group || !(0, group_service_1.is_member)(group, callerId)) {
            throw new https_1.HttpsError("permission-denied", "Not a member of this group");
        }
        userId = (0, budget_view_service_1.group_view_key)(groupId);
    }
    try {
        console.log(`[getCategoryOwnershipMap] Fetching ownership map for user: ${userId}`);
        const ownershipMap = await (0, categoryOwnership_1.getCategoryOwnership)(userId);
        const budgets = await (0, categoryOwnership_1.getUserBudgets)(userId);
        const budgetNames = {};
        for (const budget of budgets) {
            budgetNames[budget.id] = budget.name;
        }
        const categories = await (0, categoryOwnership_1.getActiveCategories)();
        const categoryNames = {};
        for (const cat of categories) {
            categoryNames[cat.id] = cat.name;
        }
        const result = {
            ownership: ownershipMap.ownership,
            budgetNames,
            categoryNames,
            everythingElseBudgetId: ownershipMap.everythingElseBudgetId,
            ownershipByFirst: ownershipMap.ownershipByFirst,
            firstCategoryNames: ownershipMap.firstCategoryNames,
            unassignedCount: ownershipMap.unassignedCategoryIds.length,
            totalCategories: ownershipMap.allCategoryIds.length,
        };
        console.log(`[getCategoryOwnershipMap] Returning ${result.totalCategories} categories, ` +
            `${result.unassignedCount} unassigned, ${Object.keys(result.ownershipByFirst).length} firsts`);
        return result;
    }
    catch (error) {
        console.error("[getCategoryOwnershipMap] Error:", error);
        throw new https_1.HttpsError("internal", "Failed to get category ownership map");
    }
});
//# sourceMappingURL=getCategoryOwnershipMap.js.map