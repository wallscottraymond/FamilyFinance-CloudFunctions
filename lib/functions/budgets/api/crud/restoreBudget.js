"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.restoreBudget = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../../../types");
// Firestore utilities not needed - using direct db access
const auth_1 = require("../../../../utils/auth");
const cors_1 = require("../../../../middleware/cors");
const db = admin.firestore();
/**
 * Restore a deleted budget
 *
 * Removes the deletion flags and reactivates the budget and all its periods.
 * Can only be done within the grace period (before permanent deletion).
 */
exports.restoreBudget = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        var _a;
        if (request.method !== "POST") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only POST requests are allowed"));
        }
        try {
            const budgetId = ((_a = request.body) === null || _a === void 0 ? void 0 : _a.budgetId) || request.query.id;
            if (!budgetId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("missing-parameter", "Budget ID is required"));
            }
            // Authenticate user
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.VIEWER);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            // Get the budget (including soft-deleted ones)
            const budgetRef = db.collection("budgets").doc(budgetId);
            const budgetDoc = await budgetRef.get();
            if (!budgetDoc.exists) {
                return response.status(404).json((0, auth_1.createErrorResponse)("budget-not-found", "Budget not found"));
            }
            const existingBudget = Object.assign({ id: budgetDoc.id }, budgetDoc.data());
            // Check if budget is flagged for deletion
            if (!existingBudget.flaggedForDeletion) {
                return response.status(400).json((0, auth_1.createErrorResponse)("not-deleted", "This budget is not deleted and does not need to be restored"));
            }
            // Check permissions: OWNER always allowed, OR EDITOR/ADMIN role
            const isOwner = existingBudget.createdBy === user.id;
            const isEditor = user.role === types_1.UserRole.EDITOR || user.role === types_1.UserRole.ADMIN;
            if (!isOwner && !isEditor) {
                return response.status(403).json((0, auth_1.createErrorResponse)("permission-denied", "Cannot restore this budget - you must be the owner or have editor role"));
            }
            // Check access
            if (existingBudget.isShared && existingBudget.familyId) {
                if (!await (0, auth_1.checkFamilyAccess)(user.id, existingBudget.familyId)) {
                    return response.status(403).json((0, auth_1.createErrorResponse)("access-denied", "Cannot access this family budget"));
                }
            }
            else {
                if (existingBudget.createdBy !== user.id) {
                    return response.status(403).json((0, auth_1.createErrorResponse)("access-denied", "Cannot restore budget created by another user"));
                }
            }
            const restoreFields = {
                isActive: true,
                flaggedForDeletion: admin.firestore.FieldValue.delete(),
                deletionScheduledAt: admin.firestore.FieldValue.delete(),
                deletedBy: admin.firestore.FieldValue.delete(),
                deletedAt: admin.firestore.FieldValue.delete(),
                restoredBy: user.id,
                restoredAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            // Restore the budget
            console.log(`[restoreBudget] Restoring budget: ${budgetId}`);
            await budgetRef.update(restoreFields);
            // Restore all budget_periods for this budget
            console.log(`[restoreBudget] Restoring budget_periods for budget: ${budgetId}`);
            const budgetPeriodsSnapshot = await db
                .collection("budget_periods")
                .where("budgetId", "==", budgetId)
                .where("flaggedForDeletion", "==", true)
                .get();
            if (!budgetPeriodsSnapshot.empty) {
                let batch = db.batch();
                let batchCount = 0;
                for (const doc of budgetPeriodsSnapshot.docs) {
                    batch.update(doc.ref, restoreFields);
                    batchCount++;
                    // Firestore batch limit is 500
                    if (batchCount >= 500) {
                        await batch.commit();
                        console.log(`[restoreBudget] Restored batch of ${batchCount} budget_periods`);
                        batch = db.batch();
                        batchCount = 0;
                    }
                }
                if (batchCount > 0) {
                    await batch.commit();
                    console.log(`[restoreBudget] Restored final batch of ${batchCount} budget_periods`);
                }
                console.log(`[restoreBudget] Restored ${budgetPeriodsSnapshot.size} budget_periods total`);
            }
            console.log(`[restoreBudget] Successfully restored budget: ${budgetId}`);
            return response.status(200).json((0, auth_1.createSuccessResponse)({
                restored: true,
                budgetId,
                budgetName: existingBudget.name,
                budgetPeriodsRestored: budgetPeriodsSnapshot.size,
            }));
        }
        catch (error) {
            console.error("Error restoring budget:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to restore budget"));
        }
    });
});
//# sourceMappingURL=restoreBudget.js.map