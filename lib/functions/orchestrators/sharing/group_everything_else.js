"use strict";
/**
 * Group Everything Else (D6, PD6)
 *
 * Each view has its own Everything Else budgets (one per cadence). For a group
 * the owner key is "group:<id>". Provisioning is idempotent (the shared helper
 * skips cadences that already exist), so it's safe to call whenever a budget
 * enters a group; group creation calls it first.
 *
 * @module orchestrators/sharing/group_everything_else
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensure_group_everything_else = ensure_group_everything_else;
const firestore_1 = require("firebase-admin/firestore");
const createEverythingElseBudget_1 = require("../../budgets/utils/createEverythingElseBudget");
const budget_view_service_1 = require("../../domain/sharing/budget_view.service");
/** Ensures the group's Everything Else budgets exist. Never throws. */
async function ensure_group_everything_else(ctx, group_id) {
    try {
        await (0, createEverythingElseBudget_1.createEverythingElseBudget)((0, firestore_1.getFirestore)(), (0, budget_view_service_1.group_view_key)(group_id));
    }
    catch (error) {
        console.error(`[${ctx.trace_id}] ensure_group_everything_else(${group_id}) failed:`, error instanceof Error ? error.message : error);
    }
}
//# sourceMappingURL=group_everything_else.js.map